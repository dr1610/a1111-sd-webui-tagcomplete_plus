import csv
import gzip
import json
import shutil
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import gradio as gr
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from modules import script_callbacks, shared


TACP_SECTION = ("tag-autocomplete-plus", "Tag Autocomplete Plus")
PLUS_PATH = Path(__file__).resolve().parents[1]
PLUS_TAGS_PATH = PLUS_PATH.joinpath("tags")
PLUS_DOWNLOAD_PATH = PLUS_TAGS_PATH.joinpath(".download")
PLUS_META_PATH = PLUS_TAGS_PATH.joinpath("danbooru_csv_meta.json")
HF_DATASET_ID = "newtextdoc1111/danbooru-tag-csv"
HF_BASE_URL = f"https://huggingface.co/datasets/{HF_DATASET_ID}/resolve/main"
DANBOORU_TAGS_FILE = "danbooru_tags.csv"
DANBOORU_COOCCURRENCE_FILE = "danbooru_tags_cooccurrence.csv"
DANBOORU_COOCCURRENCE_GZ_FILE = f"{DANBOORU_COOCCURRENCE_FILE}.gz"
RELATED_CACHE = {"mtime": None, "data": {}}
TAG_COUNT_CACHE = {"mtime": None, "data": {}}
DOWNLOAD_STATE = {
    "running": False,
    "last_result": None,
    "last_error": None,
}


def ensure_dirs():
    PLUS_TAGS_PATH.mkdir(parents=True, exist_ok=True)
    PLUS_DOWNLOAD_PATH.mkdir(parents=True, exist_ok=True)


def load_meta():
    if not PLUS_META_PATH.exists():
        return {"version": 1, "files": {}}
    try:
        with PLUS_META_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            data.setdefault("version", 1)
            data.setdefault("files", {})
            return data
    except Exception as exc:
        print(f"Tag Autocomplete Plus: failed to read metadata: {exc}")
    return {"version": 1, "files": {}}


def save_meta(meta):
    ensure_dirs()
    with PLUS_META_PATH.open("w", encoding="utf-8") as handle:
        json.dump(meta, handle, indent=2)


def valid_file(path: Path):
    return path.exists() and path.is_file() and path.stat().st_size > 0


def unpack_bundled_cooccurrence():
    final_path = PLUS_TAGS_PATH.joinpath(DANBOORU_COOCCURRENCE_FILE)
    gz_path = PLUS_TAGS_PATH.joinpath(DANBOORU_COOCCURRENCE_GZ_FILE)
    if valid_file(final_path) or not valid_file(gz_path):
        return False

    tmp_path = PLUS_TAGS_PATH.joinpath(f"{DANBOORU_COOCCURRENCE_FILE}.tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    print(f"Tag Autocomplete Plus: unpacking bundled {DANBOORU_COOCCURRENCE_GZ_FILE}")
    with gzip.open(gz_path, "rb") as source:
        with tmp_path.open("wb") as target:
            shutil.copyfileobj(source, target, length=1024 * 1024)
    shutil.move(tmp_path, final_path)
    print(f"Tag Autocomplete Plus: unpacked {DANBOORU_COOCCURRENCE_FILE}")
    return True


def download_file(file_name: str, force: bool = False):
    ensure_dirs()
    final_path = PLUS_TAGS_PATH.joinpath(file_name)
    if valid_file(final_path) and not force:
        return {"file": file_name, "status": "exists", "size": final_path.stat().st_size}

    tmp_path = PLUS_DOWNLOAD_PATH.joinpath(file_name)
    url = f"{HF_BASE_URL}/{file_name}"
    if tmp_path.exists():
        tmp_path.unlink()

    print(f"Tag Autocomplete Plus: downloading {file_name} from {url}")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "a1111-sd-webui-tagcomplete-plus"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        with tmp_path.open("wb") as handle:
            shutil.copyfileobj(response, handle, length=1024 * 1024)

    if not valid_file(tmp_path):
        raise RuntimeError(f"Downloaded file is empty: {file_name}")

    shutil.move(tmp_path, final_path)
    return {"file": file_name, "status": "downloaded", "size": final_path.stat().st_size}


def download_danbooru_csv(force: bool = False):
    meta = load_meta()
    results = []
    for file_name in [DANBOORU_TAGS_FILE, DANBOORU_COOCCURRENCE_FILE]:
        result = download_file(file_name, force)
        results.append(result)
        meta["files"][file_name] = {
            "last_download": datetime.now(timezone.utc).isoformat(),
            "status": result["status"],
            "size": result["size"],
        }
    save_meta(meta)
    RELATED_CACHE["mtime"] = None
    TAG_COUNT_CACHE["mtime"] = None
    return results


def start_download_thread(force: bool = False):
    if DOWNLOAD_STATE["running"]:
        return False

    def worker():
        DOWNLOAD_STATE["running"] = True
        DOWNLOAD_STATE["last_error"] = None
        try:
            DOWNLOAD_STATE["last_result"] = download_danbooru_csv(force)
            print("Tag Autocomplete Plus: Danbooru CSV download finished.")
        except Exception as exc:
            DOWNLOAD_STATE["last_error"] = str(exc)
            print(f"Tag Autocomplete Plus: Danbooru CSV download failed: {exc}")
        finally:
            DOWNLOAD_STATE["running"] = False

    threading.Thread(target=worker, daemon=True).start()
    return True


def normalize_tag(tag: str) -> str:
    return tag.strip().strip('"').replace(" ", "_").lower()


def load_tag_counts():
    path = PLUS_TAGS_PATH.joinpath(DANBOORU_TAGS_FILE)
    if not valid_file(path):
        return {}

    mtime = path.stat().st_mtime
    if TAG_COUNT_CACHE["mtime"] == mtime:
        return TAG_COUNT_CACHE["data"]

    counts = {}
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle)
            for row in reader:
                if len(row) < 3:
                    continue
                tag = normalize_tag(row[0])
                if not tag or tag == "tag":
                    continue
                try:
                    counts[tag] = int(float(row[2]))
                except ValueError:
                    continue
    except Exception as exc:
        print(f"Tag Autocomplete Plus: failed to read {DANBOORU_TAGS_FILE}: {exc}")

    TAG_COUNT_CACHE["mtime"] = mtime
    TAG_COUNT_CACHE["data"] = counts
    print(f"Tag Autocomplete Plus: loaded {len(counts)} Danbooru tag counts.")
    return counts


def relation_files():
    unpack_bundled_cooccurrence()
    if not PLUS_TAGS_PATH.exists():
        return []

    patterns = [
        "*cooccurrence*.csv",
        "*co-occurrence*.csv",
        "*related*.csv",
    ]
    found = []
    for pattern in patterns:
        found.extend(PLUS_TAGS_PATH.glob(pattern))
    return sorted({p for p in found if p.is_file()})


def data_status():
    cooccurrence_path = PLUS_TAGS_PATH.joinpath(DANBOORU_COOCCURRENCE_FILE)
    tags_path = PLUS_TAGS_PATH.joinpath(DANBOORU_TAGS_FILE)
    files = relation_files()
    non_demo_files = [path for path in files if not path.name.startswith("demo-")]
    return {
        "downloadRunning": DOWNLOAD_STATE["running"],
        "downloadError": DOWNLOAD_STATE["last_error"],
        "hasDanbooruTags": valid_file(tags_path),
        "hasDanbooruCooccurrence": valid_file(cooccurrence_path),
        "hasOnlyDemoCooccurrence": bool(files) and not non_demo_files and not valid_file(cooccurrence_path),
        "relationFiles": [path.name for path in files],
    }


def read_relations():
    files = relation_files()
    mtime = tuple((path.as_posix(), path.stat().st_mtime) for path in files)
    if RELATED_CACHE["mtime"] == mtime:
        return RELATED_CACHE["data"]

    limit_per_tag = int(getattr(shared.opts, "tacp_relationCacheLimit", 500))
    tag_counts = load_tag_counts()
    relations = {}

    for path in files:
        try:
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.reader(handle)
                for row in reader:
                    if len(row) < 2:
                        continue

                    left = normalize_tag(row[0])
                    right = normalize_tag(row[1])
                    if not left or not right or left in {"tag", "tag_a", "tag1"}:
                        continue

                    try:
                        count = int(float(row[2])) if len(row) > 2 and row[2] else 0
                    except ValueError:
                        count = 0

                    relations.setdefault(left, []).append({"tag": right, "count": count})
                    relations.setdefault(right, []).append({"tag": left, "count": count})
        except Exception as exc:
            print(f"Tag Autocomplete Plus: failed to read {path.name}: {exc}")

    for tag, items in relations.items():
        deduped = {}
        for item in items:
            previous = deduped.get(item["tag"])
            if previous is None or item["count"] > previous["count"]:
                deduped[item["tag"]] = item
        count_a = tag_counts.get(tag, 0)
        for item in deduped.values():
            count_b = tag_counts.get(item["tag"], 0)
            union = count_a + count_b - item["count"]
            item["score"] = item["count"] / union if union > 0 else 0
        relations[tag] = sorted(
            deduped.values(),
            key=lambda item: (item.get("score", 0), item["count"]),
            reverse=True,
        )[:limit_per_tag]

    RELATED_CACHE["mtime"] = mtime
    RELATED_CACHE["data"] = relations
    print(f"Tag Autocomplete Plus: loaded {len(relations)} related-tag entries from {len(files)} CSV file(s).")
    return relations


def on_ui_settings():
    shared.opts.add_option(
        "tacp_enableRelatedTags",
        shared.OptionInfo(True, "Enable related tag panel", section=TACP_SECTION),
    )
    shared.opts.add_option(
        "tacp_relatedMaxResults",
        shared.OptionInfo(24, "Maximum related tags", gr.Slider, {"minimum": 4, "maximum": 80, "step": 1}, section=TACP_SECTION),
    )
    shared.opts.add_option(
        "tacp_relatedTriggerMode",
        shared.OptionInfo("Ctrl+Shift+Space or click", "Related tag trigger mode", gr.Dropdown, lambda: {
            "choices": ["Ctrl+Shift+Space or click", "Ctrl+Shift+Space only"]
        }, section=TACP_SECTION),
    )
    shared.opts.add_option(
        "tacp_relationCacheLimit",
        shared.OptionInfo(500, "Maximum cached relations per tag", gr.Slider, {"minimum": 50, "maximum": 2000, "step": 50}, section=TACP_SECTION),
    )
    shared.opts.add_option(
        "tacp_autoDownloadDanbooru",
        shared.OptionInfo(True, "Download Danbooru CSV automatically when missing", section=TACP_SECTION),
    )
    shared.opts.add_option(
        "tacp_downloadDanbooruNow",
        shared.OptionInfo("Download/update Danbooru CSV", "Download/update Danbooru CSV", gr.HTML, {}, refresh=download_danbooru_csv, section=TACP_SECTION),
    )


def api_tac_plus(_: gr.Blocks, app: FastAPI):
    @app.get("/tacplusapi/v1/config")
    async def config():
        return {
            "enableRelatedTags": bool(getattr(shared.opts, "tacp_enableRelatedTags", True)),
            "relatedMaxResults": int(getattr(shared.opts, "tacp_relatedMaxResults", 24)),
            "relatedTriggerMode": getattr(shared.opts, "tacp_relatedTriggerMode", "Ctrl+Shift+Space or click"),
            "downloadState": DOWNLOAD_STATE,
            "dataStatus": data_status(),
        }

    @app.get("/tacplusapi/v1/related")
    async def related(tag: str, limit: int = 24):
        key = normalize_tag(tag)
        if not key:
            return {"tag": tag, "results": []}

        relations = read_relations()
        items = relations.get(key, [])[: max(0, min(int(limit), 100))]
        return {"tag": key, "results": items, "status": data_status()}

    @app.post("/tacplusapi/v1/reload-related")
    async def reload_related():
        RELATED_CACHE["mtime"] = None
        data = read_relations()
        return JSONResponse({
            "tags": len(data),
            "path": PLUS_TAGS_PATH.as_posix(),
            "files": [p.name for p in relation_files()],
        })

    @app.post("/tacplusapi/v1/download-danbooru")
    async def api_download_danbooru(force: bool = False):
        started = start_download_thread(force)
        return JSONResponse({"started": started, "state": DOWNLOAD_STATE})

    @app.get("/tacplusapi/v1/download-state")
    async def api_download_state():
        return DOWNLOAD_STATE


script_callbacks.on_ui_settings(on_ui_settings)
script_callbacks.on_app_started(api_tac_plus)


def auto_download_on_startup():
    unpack_bundled_cooccurrence()
    if not bool(getattr(shared.opts, "tacp_autoDownloadDanbooru", True)):
        return
    missing = [
        file_name
        for file_name in [DANBOORU_TAGS_FILE, DANBOORU_COOCCURRENCE_FILE]
        if not valid_file(PLUS_TAGS_PATH.joinpath(file_name))
    ]
    if missing:
        print(f"Tag Autocomplete Plus: missing Danbooru CSV file(s): {', '.join(missing)}")
        start_download_thread(force=False)


script_callbacks.on_app_started(lambda _blocks, _app: auto_download_on_startup())
