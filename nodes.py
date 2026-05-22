import os
import json
import glob
import time
import subprocess
import shutil
from pathlib import Path
import folder_paths
from aiohttp import web
from server import PromptServer

NODE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(NODE_DIR, 'config.json')
SUBFOLDER = "one-node-flux-2-klein"


def _favorites_path():
    return os.path.join(NODE_DIR, "favorites.json")


def _load_favorites():
    path = _favorites_path()
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return set(data) if isinstance(data, list) else set()
        except Exception:
            return set()
    # First run: build index by scanning existing sidecar JSONs (both locations)
    favs = set()
    try:
        subf_dir = os.path.join(_get_output_dir(), SUBFOLDER)
        if os.path.isdir(subf_dir):
            scan_dirs = [subf_dir, os.path.join(subf_dir, "metadata")]
            for d in scan_dirs:
                if not os.path.isdir(d):
                    continue
                for jf in glob.glob(os.path.join(d, "*.json")):
                    try:
                        with open(jf, "r", encoding="utf-8") as f:
                            md = json.load(f)
                        if md.get("favorite") is True:
                            png = os.path.splitext(os.path.basename(jf))[0] + ".png"
                            favs.add(png)
                    except Exception:
                        pass
        if favs:
            _save_favorites(favs)
    except Exception:
        pass
    return favs


def _save_favorites(favset):
    path = _favorites_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sorted(favset), f, ensure_ascii=False, indent=2)


def _favorites_add(filename):
    favs = _load_favorites()
    favs.add(filename)
    _save_favorites(favs)


def _favorites_remove(filename):
    favs = _load_favorites()
    favs.discard(filename)
    _save_favorites(favs)



def _safe_resolve_output_path(output_dir, subfolder="", filename=""):
    base = Path(output_dir).resolve()
    target = base
    if subfolder:
        target = target / subfolder
    if filename:
        target = target / filename
    target = target.resolve()
    try:
        target.relative_to(base)
    except Exception:
        raise ValueError("invalid path")
    return str(target)


def _safe_resolve_input_path(filename=""):
    base = Path(folder_paths.get_input_directory()).resolve()
    target = (base / filename).resolve()
    try:
        target.relative_to(base)
    except Exception:
        raise ValueError("invalid input path")
    return str(target)


def _file_key(filename, subfolder=""):
    return f"{subfolder}/{filename}" if subfolder else filename


def _load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _get_output_dir():
    try:
        return folder_paths.get_output_directory()
    except Exception:
        return os.path.join(os.path.dirname(NODE_DIR), "output")


def _find_ffmpeg():
    try:
        from custom_nodes.ComfyUI_VideoHelperSuite.videohelpersuite.utils import ffmpeg_path
        if os.path.isfile(ffmpeg_path):
            return ffmpeg_path
    except Exception:
        pass
    try:
        import custom_nodes.ComfyUI_VideoHelperSuite.videohelpersuite.ffmpeg_path as vhs_fp
        p = vhs_fp.get_ffmpeg_path() if hasattr(vhs_fp, 'get_ffmpeg_path') else getattr(vhs_fp, 'ffmpeg_path', '')
        if p and os.path.isfile(p):
            return p
    except Exception:
        pass
    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    root = NODE_DIR
    for _ in range(6):
        if os.path.isdir(os.path.join(root, "custom_nodes")):
            break
        root = os.path.dirname(root)
    for vhs_name in ["ComfyUI-VideoHelperSuite", "ComfyUI_VideoHelperSuite", "comfyui-videohelpersuite"]:
        vhs_dir = os.path.join(root, "custom_nodes", vhs_name)
        if os.path.isdir(vhs_dir):
            for r2, _, files in os.walk(vhs_dir):
                if exe in files:
                    return os.path.join(r2, exe)
    portable = os.path.dirname(root)
    for candidate in [os.path.join(portable, exe), os.path.join(root, exe), os.path.join(portable, "bin", exe)]:
        if os.path.isfile(candidate):
            return candidate
    found = shutil.which("ffmpeg")
    if found:
        return found
    return None


_ffmpeg_path = None


def _ff():
    global _ffmpeg_path
    if _ffmpeg_path is None:
        _ffmpeg_path = _find_ffmpeg() or ""
    return _ffmpeg_path or None


def _meta_dir(image_path):
    """Returns the metadata/ subdirectory for the folder containing image_path."""
    return os.path.join(os.path.dirname(image_path), "metadata")


def _meta_path(image_path):
    """New canonical location: <image_dir>/metadata/<basename>.json"""
    fname = os.path.splitext(os.path.basename(image_path))[0] + ".json"
    return os.path.join(_meta_dir(image_path), fname)


def _meta_path_legacy(image_path):
    """Old location: <image_dir>/<basename>.json (sidecar next to image)"""
    base, _ = os.path.splitext(image_path)
    return base + ".json"


def _migrate_meta_sidecars():
    """One-time migration: move *.json sidecars next to PNGs into metadata/ subdir."""
    try:
        subf_dir = os.path.join(_get_output_dir(), SUBFOLDER)
        if not os.path.isdir(subf_dir):
            return
        meta_dir = os.path.join(subf_dir, "metadata")
        os.makedirs(meta_dir, exist_ok=True)
        moved = 0
        for jf in glob.glob(os.path.join(subf_dir, "*.json")):
            basename = os.path.basename(jf)
            dest = os.path.join(meta_dir, basename)
            if not os.path.exists(dest):
                try:
                    shutil.move(jf, dest)
                    moved += 1
                except Exception as e:
                    print(f"[FluxKlein] migrate sidecar {basename}: {e}")
            else:
                try:
                    os.remove(jf)
                except Exception:
                    pass
        if moved:
            print(f"[FluxKlein] Migrated {moved} metadata sidecar(s) to metadata/")
    except Exception as e:
        print(f"[FluxKlein] migrate_meta_sidecars error: {e}")


# â”€â”€ PNG tEXt chunk helpers (no external deps) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def _png_embed_meta(png_path, meta_dict):
    """Embed metadata JSON into a PNG file as a tEXt chunk with keyword 'Comment'."""
    import struct, zlib
    try:
        with open(png_path, "rb") as f:
            data = f.read()
        if data[:8] != b'\x89PNG\r\n\x1a\n':
            return False
        meta_json = json.dumps(meta_dict, ensure_ascii=False, separators=(',', ':'))
        keyword = b'Comment'
        text_data = keyword + b'\x00' + meta_json.encode('utf-8')
        crc = zlib.crc32(b'tEXt' + text_data) & 0xFFFFFFFF
        chunk = struct.pack('>I', len(text_data)) + b'tEXt' + text_data + struct.pack('>I', crc)
        # Insert after IHDR chunk (first chunk after signature)
        sig = data[:8]
        # Find position after IHDR
        pos = 8
        ihdr_len = struct.unpack('>I', data[8:12])[0]
        pos += 12 + ihdr_len  # skip length(4) + type(4) + data + crc(4)
        # Strip existing tEXt Comment chunks to avoid duplicates
        new_body = bytearray()
        i = 8
        while i < len(data) - 4:
            try:
                clen = struct.unpack('>I', data[i:i+4])[0]
                ctype = data[i+4:i+8]
                if ctype == b'tEXt':
                    chunk_data = data[i+8:i+8+clen]
                    if chunk_data.startswith(b'Comment\x00'):
                        i += 12 + clen
                        continue
                new_body += data[i:i+12+clen]
                if ctype == b'IEND':
                    break
                i += 12 + clen
            except Exception:
                new_body += data[i:]
                break
        # Build final PNG: sig + IHDR + tEXt chunk + rest
        # Re-parse IHDR from new_body
        final = bytearray(sig)
        j = 0
        inserted = False
        while j < len(new_body):
            try:
                clen = struct.unpack('>I', bytes(new_body[j:j+4]))[0]
                ctype = new_body[j+4:j+8]
                final += new_body[j:j+12+clen]
                j += 12 + clen
                if not inserted and ctype == b'IHDR':
                    final += chunk
                    inserted = True
            except Exception:
                final += new_body[j:]
                break
        if not inserted:
            final += chunk
        tmp = png_path + ".fkmeta.tmp"
        try:
            with open(tmp, "wb") as f:
                f.write(final)
            # On Windows, the PNG may still be held by ComfyUI's SaveImage node briefly.
            # Retry os.replace up to 5 times with short delays before giving up.
            import time
            for attempt in range(5):
                try:
                    os.replace(tmp, png_path)
                    break
                except OSError:
                    if attempt == 4:
                        raise
                    time.sleep(0.3)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
        return True
    except Exception as e:
        print(f"[FluxKlein] png_embed_meta error: {e}")
        return False


def _png_read_meta(png_path):
    """Read metadata JSON from PNG tEXt Comment chunk."""
    import struct
    try:
        with open(png_path, "rb") as f:
            data = f.read()
        if data[:8] != b'\x89PNG\r\n\x1a\n':
            return None
        i = 8
        while i < len(data) - 4:
            try:
                clen = struct.unpack('>I', data[i:i+4])[0]
                ctype = data[i+4:i+8]
                if ctype == b'tEXt':
                    chunk_data = data[i+8:i+8+clen]
                    if chunk_data.startswith(b'Comment\x00'):
                        raw = chunk_data[8:].decode('utf-8', errors='replace')
                        parsed = json.loads(raw)
                        if isinstance(parsed, dict):
                            return parsed
                if ctype == b'IEND':
                    break
                i += 12 + clen
            except Exception:
                break
        return None
    except Exception as e:
        print(f"[FluxKlein] png_read_meta error: {e}")
        return None


def _read_json_meta(image_path):
    """Read metadata: try PNG tEXt chunk first, then metadata/ sidecar, then legacy sidecar."""
    _VALID = ("v", "prompt", "w", "h", "mode", "favorite", "favourite")
    # 1. PNG tEXt chunk
    if image_path.lower().endswith('.png') and os.path.exists(image_path):
        meta = _png_read_meta(image_path)
        if meta and isinstance(meta, dict) and any(k in meta for k in _VALID):
            return meta
    # 2. metadata/ subdir sidecar
    for mp in (_meta_path(image_path), _meta_path_legacy(image_path)):
        if not os.path.exists(mp):
            continue
        try:
            with open(mp, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and any(k in data for k in _VALID):
                return data
        except Exception as e:
            print(f"[FluxKlein] read_json_meta error: {e}")
    return None


def _write_json_meta(image_path, meta_dict):
    """Write metadata: embed into PNG tEXt chunk (primary) + metadata/ sidecar (fallback)."""
    ok_png = False
    if image_path.lower().endswith('.png') and os.path.exists(image_path):
        orig_mtime = os.path.getmtime(image_path)
        ok_png = _png_embed_meta(image_path, meta_dict)
        if ok_png:
            try:
                os.utime(image_path, (orig_mtime, orig_mtime))
            except Exception:
                pass
            print(f"[FluxKlein] Meta embedded in PNG: {os.path.basename(image_path)}")
    # Also write JSON sidecar into metadata/ subdir
    mp = _meta_path(image_path)
    tmp = mp + ".tmp"
    try:
        os.makedirs(os.path.dirname(mp), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(meta_dict, f, ensure_ascii=False, indent=2)
        os.replace(tmp, mp)
        return True
    except Exception as e:
        print(f"[FluxKlein] write_json_meta error: {e}")
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except Exception:
                pass
        return ok_png  # return True if at least PNG embed succeeded


def _serve_json(filename):
    async def handler(request):
        path = os.path.join(NODE_DIR, filename)
        if not os.path.exists(path):
            return web.Response(status=404, text=f"{filename} not found")
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return web.json_response(data)
    return handler


PromptServer.instance.routes.get("/flux_klein/workflow_t2i")(_serve_json("workflows/t2i_workflow.json"))
PromptServer.instance.routes.get("/flux_klein/workflow_i2i")(_serve_json("workflows/i2i_workflow.json"))
PromptServer.instance.routes.get("/flux_klein/workflow_edit")(_serve_json("workflows/edit_workflow.json"))
PromptServer.instance.routes.get("/flux_klein/workflow_inpaint")(_serve_json("workflows/inpaint_workflow.json"))
PromptServer.instance.routes.get("/flux_klein/workflow_outpaint")(_serve_json("workflows/outpaint_workflow.json"))
PromptServer.instance.routes.get("/flux_klein/workflow_faceswap")(_serve_json("workflows/faceswap_workflow.json"))
PromptServer.instance.routes.get("/flux_klein/workflow_remove_bg")(_serve_json("workflows/remove_bg_workflow.json"))


@PromptServer.instance.routes.get("/flux_klein/bgremoval_models")
async def get_bgremoval_models(request):
    """Scan models/background_removal/ for all model files."""
    try:
        models_dir = folder_paths.models_dir
    except Exception:
        models_dir = os.path.join(os.path.dirname(os.path.dirname(NODE_DIR)), "models")
    bg_dir = os.path.join(models_dir, "background_removal")
    found = []
    exts = [".safetensors", ".onnx", ".pt", ".pth"]
    if os.path.isdir(bg_dir):
        for fn in os.listdir(bg_dir):
            if any(fn.lower().endswith(e) for e in exts):
                found.append(fn)
    found = sorted(found)
    return web.json_response({"models": found})


@PromptServer.instance.routes.get("/flux_klein/config")
async def get_config(request):
    cfg = _load_config()
    return web.json_response({
        "dummy": cfg.get("dummy", ""),
        "lora_triggers_custom": cfg.get("lora_triggers_custom", {}),
        "t2i_templates": cfg.get("t2i_templates", []),
        "discover_prompts": cfg.get("discover_prompts", {}),
        "autofill_prompts": cfg.get("autofill_prompts", {}),
    })


@PromptServer.instance.routes.post("/flux_klein/config")
async def save_config_route(request):
    try:
        patch = await request.json()
        if not isinstance(patch, dict):
            return web.json_response({"ok": False, "error": "invalid payload"}, status=400)
        cfg = _load_config()
        cfg.update({k: v for k, v in patch.items()})
        _save_config(cfg)
        return web.json_response({"ok": True})
    except Exception as e:
        print(f"[FluxKlein] config save error: {e}")
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/flux_klein/gallery")
async def get_gallery(request):
    output_dir = _get_output_dir()
    try:
        offset = max(0, int(request.query.get("offset", 0)))
    except Exception:
        offset = 0
    try:
        limit = min(max(1, int(request.query.get("limit", 20))), 200)
    except Exception:
        limit = 20
    subf = request.query.get("subfolder", "")
    favonly = request.query.get("favonly", "0") == "1"
    try:
        search = _safe_resolve_output_path(output_dir, subf) if subf else output_dir
    except ValueError:
        return web.json_response({"images": [], "total": 0, "offset": offset, "limit": limit, "error": "invalid subfolder"}, status=400)

    assets_dir = os.path.normpath(_safe_resolve_output_path(output_dir, os.path.join(SUBFOLDER, "assets")))

    if favonly:
        # Fast path: read favorites index, resolve to existing files sorted by mtime
        fav_names = _load_favorites()
        subf_dir = os.path.normpath(_safe_resolve_output_path(output_dir, SUBFOLDER))
        unique = []
        missing = set()
        for name in fav_names:
            p = os.path.join(subf_dir, name)
            if os.path.isfile(p):
                unique.append(p)
            else:
                missing.add(name)
        if missing:
            _save_favorites(fav_names - missing)
        unique.sort(key=os.path.getmtime, reverse=True)
    else:
        search_norm = os.path.normpath(search)
        exclude_assets = not search_norm.startswith(assets_dir + os.sep) and search_norm != assets_dir
        unique = []
        if os.path.isdir(search):
            pngs = glob.glob(os.path.join(search, "**", "*.png"), recursive=True)
            filtered = [p for p in pngs if not exclude_assets or not os.path.normpath(p).startswith(assets_dir + os.sep)]
            unique = sorted(set(filtered), key=os.path.getmtime, reverse=True)

    fav_set = _load_favorites() if not favonly else fav_names
    images = []
    for f in unique[offset:offset + limit]:
        rel = os.path.relpath(os.path.dirname(f), output_dir)
        fname = os.path.basename(f)
        images.append({
            "filename": fname,
            "subfolder": "" if rel == "." else rel,
            "mtime": os.path.getmtime(f),
            "key": _file_key(fname, "" if rel == "." else rel),
            "has_meta": os.path.exists(_meta_path(f)) or os.path.exists(_meta_path_legacy(f)),
            "favorite": fname in fav_set,
        })
    return web.json_response({"images": images, "total": len(unique), "offset": offset, "limit": limit})


@PromptServer.instance.routes.post("/flux_klein/save_meta")
async def save_meta(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "")
        meta = data.get("meta", {})
        if not filename:
            return web.json_response({"ok": False, "error": "no filename"})
        output_dir = _get_output_dir()
        try:
            vpath = _safe_resolve_output_path(output_dir, subfolder, filename)
        except ValueError:
            return web.json_response({"ok": False, "error": "invalid path"}, status=400)
        if not os.path.exists(vpath):
            return web.json_response({"ok": False, "error": f"not found: {vpath}"})
        ok = _write_json_meta(vpath, meta)
        return web.json_response({"ok": ok, "filename": filename})
    except Exception as e:
        print(f"[FluxKlein] save_meta error: {e}")
        return web.json_response({"ok": False, "error": str(e)})


@PromptServer.instance.routes.post("/flux_klein/update_meta")
async def update_meta(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "")
        patch = data.get("patch", {})
        if not filename or not isinstance(patch, dict):
            return web.json_response({"ok": False, "error": "bad request"})
        output_dir = _get_output_dir()
        try:
            vpath = _safe_resolve_output_path(output_dir, subfolder, filename)
        except ValueError:
            return web.json_response({"ok": False, "error": "invalid path"}, status=400)
        existing = _read_json_meta(vpath) or {}
        existing.update(patch)
        ok = _write_json_meta(vpath, existing)
        if "favorite" in patch:
            if patch["favorite"] is True:
                _favorites_add(filename)
            else:
                _favorites_remove(filename)
        return web.json_response({"ok": ok})
    except Exception as e:
        print(f"[FluxKlein] update_meta error: {e}")
        return web.json_response({"ok": False, "error": str(e)})


@PromptServer.instance.routes.get("/flux_klein/meta")
async def get_meta(request):
    filename = request.query.get("filename", "")
    subfolder = request.query.get("subfolder", "")
    if not filename:
        return web.json_response({"ok": False, "error": "no filename"})
    output_dir = _get_output_dir()
    try:
        vpath = _safe_resolve_output_path(output_dir, subfolder, filename)
    except ValueError:
        return web.json_response({"ok": False, "error": "invalid path"}, status=400)
    if not os.path.exists(vpath):
        return web.json_response({"ok": False, "error": "image not found"})
    meta = _read_json_meta(vpath)
    if meta is None:
        return web.json_response({"ok": False, "error": "no metadata"})
    return web.json_response({"ok": True, "meta": meta})


@PromptServer.instance.routes.post("/flux_klein/open_folder")
async def open_folder(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "")
        if not filename:
            return web.json_response({"ok": False, "error": "no filename"})
        output_dir = _get_output_dir()
        try:
            vpath = _safe_resolve_output_path(output_dir, subfolder, filename)
        except ValueError:
            return web.json_response({"ok": False, "error": "invalid path"}, status=400)
        if not os.path.exists(vpath):
            return web.json_response({"ok": False, "error": "file not found"})
        import platform
        import subprocess as _sp
        system = platform.system()
        if system == "Windows":
            _sp.Popen(["explorer", "/select,", vpath.replace("/", "\\")])
        elif system == "Darwin":
            _sp.Popen(["open", "-R", vpath])
        else:
            _sp.Popen(["xdg-open", os.path.dirname(vpath)])
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)})


@PromptServer.instance.routes.post("/flux_klein/delete")
async def delete_image(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "")
        if not filename:
            return web.json_response({"ok": False, "error": "filename required"}, status=400)
        output_dir = _get_output_dir()
        try:
            img_path = _safe_resolve_output_path(output_dir, subfolder, filename)
        except ValueError:
            return web.json_response({"ok": False, "error": "invalid path"}, status=400)
        if not os.path.exists(img_path):
            return web.json_response({"ok": False, "error": "file not found"}, status=404)
        os.remove(img_path)
        for json_path in (_meta_path(img_path), _meta_path_legacy(img_path)):
            if os.path.exists(json_path):
                try:
                    os.remove(json_path)
                except Exception:
                    pass
        _favorites_remove(filename)
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)})


def _scan(folder_key, extensions=None):
    exts = extensions or [".safetensors", ".ckpt", ".pt", ".pth"]
    try:
        bases = folder_paths.get_folder_paths(folder_key)
    except Exception:
        return ["none"]
    found = []
    for base in bases:
        if not os.path.isdir(base):
            continue
        for root, _, files in os.walk(base):
            for fn in files:
                if any(fn.lower().endswith(e) for e in exts):
                    found.append(os.path.relpath(os.path.join(root, fn), base))
    return sorted(found) if found else ["none"]


def _scan_path(path, extensions=None):
    exts = extensions or [".safetensors", ".ckpt", ".pt", ".pth"]
    if not os.path.isdir(path):
        return ["none"]
    found = []
    for root, _, files in os.walk(path):
        for fn in files:
            if any(fn.lower().endswith(e) for e in exts):
                found.append(os.path.relpath(os.path.join(root, fn), path))
    return sorted(found) if found else ["none"]


@PromptServer.instance.routes.get("/flux_klein/models")
async def get_models(request):
    # Diffusion models (unet) â€” flux-2-klein variants
    try:
        diff = _scan("diffusion_models")
    except Exception:
        try:
            import folder_paths as fp
            diff = _scan_path(os.path.join(os.path.dirname(getattr(fp, "models_dir", "")), "models", "diffusion_models"))
        except Exception:
            diff = ["none"]

    # Text encoders
    try:
        te = _scan("text_encoders")
    except Exception:
        te = ["none"]

    # VAEs
    try:
        vaes = _scan("vae")
    except Exception:
        vaes = ["none"]

    # LoRAs
    loras = _scan("loras")

    return web.json_response({
        "diffusion_models": diff,
        "text_encoders": te,
        "vaes": vaes,
        "loras": loras,
    })


def _read_safetensors_header(path):
    """Read only the JSON header from a .safetensors file (no weight loading)."""
    try:
        with open(path, "rb") as f:
            length_bytes = f.read(8)
            if len(length_bytes) < 8:
                return None
            import struct
            header_len = struct.unpack("<Q", length_bytes)[0]
            if header_len > 100 * 1024 * 1024:  # sanity: skip if >100MB header
                return None
            header_bytes = f.read(header_len)
        return json.loads(header_bytes.decode("utf-8"))
    except Exception:
        return None


def _extract_trigger_words(header):
    """Extract trigger words from safetensors metadata dict."""
    if not header:
        return []
    meta = header.get("__metadata__", {})
    if not isinstance(meta, dict):
        return []

    triggers = []

    # 1. modelspec.trigger_phrase (single string)
    v = meta.get("modelspec.trigger_phrase") or meta.get("trigger_phrase") or meta.get("trigger_word")
    if v and isinstance(v, str) and v.strip():
        triggers.extend([t.strip() for t in v.split(",") if t.strip()])

    # 2. ss_trigger_words (JSON array or plain string)
    raw = meta.get("ss_trigger_words")
    if raw:
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    triggers.extend([str(t).strip() for t in parsed if str(t).strip()])
                elif isinstance(parsed, str) and parsed.strip():
                    triggers.extend([t.strip() for t in parsed.split(",") if t.strip()])
            except Exception:
                triggers.extend([t.strip() for t in raw.split(",") if t.strip()])
        elif isinstance(raw, list):
            triggers.extend([str(t).strip() for t in raw if str(t).strip()])

    # 3. ss_tag_frequency â€” pick top-level keys that look like trigger words
    #    (skip generic tags like quality/style boilerplates)
    tag_freq_raw = meta.get("ss_tag_frequency")
    if tag_freq_raw and not triggers:
        try:
            tag_freq = json.loads(tag_freq_raw) if isinstance(tag_freq_raw, str) else tag_freq_raw
            if isinstance(tag_freq, dict):
                # tag_freq is {dataset_name: {tag: count, ...}, ...}
                all_tags = {}
                for ds_tags in tag_freq.values():
                    if isinstance(ds_tags, dict):
                        for tag, count in ds_tags.items():
                            all_tags[tag] = all_tags.get(tag, 0) + (count if isinstance(count, int) else 0)
                if all_tags:
                    # Return the top 5 most frequent tags as hints
                    top = sorted(all_tags.items(), key=lambda x: x[1], reverse=True)[:5]
                    triggers.extend([t for t, _ in top])
        except Exception:
            pass

    # Deduplicate preserving order
    seen = set()
    result = []
    for t in triggers:
        if t.lower() not in seen:
            seen.add(t.lower())
            result.append(t)
    return result


@PromptServer.instance.routes.get("/flux_klein/lora_triggers")
async def lora_triggers(request):
    lora_name = request.query.get("name", "")
    if not lora_name:
        return web.json_response({"ok": False, "error": "no name"}, status=400)
    try:
        bases = folder_paths.get_folder_paths("loras")
    except Exception:
        return web.json_response({"ok": False, "error": "cannot resolve loras folder"}, status=500)
    for base in bases:
        candidate = os.path.normpath(os.path.join(base, lora_name))
        # Path traversal guard
        try:
            Path(candidate).resolve().relative_to(Path(base).resolve())
        except Exception:
            continue
        if os.path.isfile(candidate) and candidate.lower().endswith(".safetensors"):
            header = _read_safetensors_header(candidate)
            triggers = _extract_trigger_words(header)
            return web.json_response({"ok": True, "triggers": triggers, "name": lora_name})
    return web.json_response({"ok": False, "error": "file not found", "triggers": []})


class FluxKleinOneNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}, "hidden": {"unique_id": "UNIQUE_ID"}}
    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "One Node"
    OUTPUT_NODE = True

    def noop(self, **kwargs):
        return {}

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")


NODE_CLASS_MAPPINGS = {"FluxKleinOneNode": FluxKleinOneNode}
NODE_DISPLAY_NAME_MAPPINGS = {"FluxKleinOneNode": "One Node · FLUX.2 [klein]"}

_migrate_meta_sidecars()
