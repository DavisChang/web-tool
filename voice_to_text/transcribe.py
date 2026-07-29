#!/usr/bin/env python3
"""Local speech-to-text using faster-whisper.

Accepts a local audio/video file, a direct audio URL, or a web page URL
(the audio link is extracted from the HTML). Everything runs on this
machine -- audio is never uploaded anywhere.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

AUDIO_RE = re.compile(r'https?://[^\s"\'<>\\]+?\.(?:mp3|m4a|wav|aac|ogg|flac|opus)(?:\?[^\s"\'<>\\]*)?')
MEDIA_EXT = {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".opus",
             ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " \
     "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def http_get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read() if binary else resp.read().decode("utf-8", "replace")


def extract_audio_url(page_url):
    """Pull the first direct audio URL out of a web page."""
    log(f"[1/3] Scanning page for audio: {page_url}")
    html = http_get(page_url)
    urls = list(dict.fromkeys(m.group(0) for m in AUDIO_RE.finditer(html)))
    if not urls:
        raise SystemExit(f"No audio URL found in {page_url}\n"
                         "Pass the .mp3/.m4a link directly, or download it first.")
    if len(urls) > 1:
        log(f"      found {len(urls)} candidates, using the first")
    log(f"      audio: {urls[0]}")
    return urls[0]


def download(url, dest_dir):
    name = re.sub(r"[?#].*$", "", url).rsplit("/", 1)[-1] or "audio.mp3"
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    dest = dest_dir / name
    if dest.exists() and dest.stat().st_size > 0:
        log(f"[2/3] Cached: {dest} ({dest.stat().st_size / 1e6:.1f} MB)")
        return dest
    log(f"[2/3] Downloading {url}")
    data = http_get(url, binary=True)
    dest.write_bytes(data)
    log(f"      saved {dest} ({len(data) / 1e6:.1f} MB)")
    return dest


def resolve_source(source, work_dir):
    """Return a local Path for anything the user threw at us."""
    p = Path(source).expanduser()
    if p.exists():
        return p
    if not source.startswith(("http://", "https://")):
        raise SystemExit(f"Not a file and not a URL: {source}")
    url = source
    # A URL that doesn't look like a media file is treated as a page to scrape.
    if Path(re.sub(r"[?#].*$", "", url)).suffix.lower() not in MEDIA_EXT:
        url = extract_audio_url(url)
    work_dir.mkdir(parents=True, exist_ok=True)
    return download(url, work_dir)


def pick_device(requested):
    if requested != "auto":
        return requested
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception:
        pass
    # CTranslate2 has no Apple-GPU backend; Apple Silicon runs on CPU.
    return "cpu"


def ts(seconds, sep=","):
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


class Writers:
    """Streams each segment to every requested output file as it arrives,
    so a long run can be inspected (or salvaged) before it finishes."""

    def __init__(self, base, formats):
        self.formats = formats
        self.files = {f: open(f"{base}.{f}", "w", encoding="utf-8") for f in formats}
        self.n = 0
        if "vtt" in self.files:
            self.files["vtt"].write("WEBVTT\n\n")
        if "json" in self.files:
            self.files["json"].write("[\n")

    def add(self, seg):
        self.n += 1
        text = seg.text.strip()
        if "txt" in self.files:
            m, s = divmod(int(seg.start), 60)
            self.files["txt"].write(f"[{m:02d}:{s:02d}] {text}\n")
        if "plain" in self.files:
            self.files["plain"].write(text + "\n")
        if "srt" in self.files:
            self.files["srt"].write(
                f"{self.n}\n{ts(seg.start)} --> {ts(seg.end)}\n{text}\n\n")
        if "vtt" in self.files:
            self.files["vtt"].write(
                f"{ts(seg.start, '.')} --> {ts(seg.end, '.')}\n{text}\n\n")
        if "json" in self.files:
            prefix = "" if self.n == 1 else ",\n"
            self.files["json"].write(prefix + "  " + json.dumps(
                {"start": round(seg.start, 3), "end": round(seg.end, 3), "text": text},
                ensure_ascii=False))
        for f in self.files.values():
            f.flush()

    def close(self):
        if "json" in self.files:
            self.files["json"].write("\n]\n")
        for f in self.files.values():
            f.close()


def main():
    ap = argparse.ArgumentParser(
        description="Local audio -> text (faster-whisper). Nothing leaves this machine.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  transcribe.py talk.mp3
  transcribe.py https://open.firstory.me/story/xxxx -m large-v3 -l zh
  transcribe.py meeting.mp4 -f txt,srt -o ~/notes
""")
    ap.add_argument("source", help="local file, direct audio URL, or page URL")
    ap.add_argument("-m", "--model", default="medium",
                    help="tiny|base|small|medium|large-v3|distil-large-v3 or a local path "
                         "(default: medium)")
    ap.add_argument("-l", "--language", default=None,
                    help="language code, e.g. zh / en / ja (default: auto-detect)")
    ap.add_argument("-f", "--format", default="txt",
                    help="comma-separated: txt,plain,srt,vtt,json (default: txt)")
    ap.add_argument("-o", "--output-dir", default=None,
                    help="where to write results (default: voice_to_text/output/)")
    ap.add_argument("-p", "--prompt", default=None,
                    help="initial prompt: names/jargon/style hints to bias decoding")
    ap.add_argument("--beam-size", type=int, default=5)
    ap.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--compute-type", default=None,
                    help="int8 / int8_float16 / float16 / float32 (default per device)")
    ap.add_argument("--no-vad", action="store_true",
                    help="disable silence filtering (use if speech gets dropped)")
    ap.add_argument("--work-dir", default=None,
                    help="download cache for URLs (default: ./.v2t-cache)")
    args = ap.parse_args()

    formats = [f.strip() for f in args.format.split(",") if f.strip()]
    unknown = set(formats) - {"txt", "plain", "srt", "vtt", "json"}
    if unknown:
        raise SystemExit(f"Unknown format(s): {', '.join(sorted(unknown))}")

    # Cache and output live next to the script, so results land in the same
    # place no matter which directory you call it from.
    here = Path(__file__).resolve().parent
    work_dir = Path(args.work_dir).expanduser() if args.work_dir \
        else here / ".v2t-cache"
    audio = resolve_source(args.source, work_dir)

    out_dir = Path(args.output_dir).expanduser() if args.output_dir \
        else here / "output"
    out_dir.mkdir(parents=True, exist_ok=True)
    base = out_dir / audio.stem

    device = pick_device(args.device)
    compute = args.compute_type or ("float16" if device == "cuda" else "int8")

    from faster_whisper import WhisperModel  # imported late so --help stays instant

    log(f"[3/3] Transcribing with {args.model} on {device}/{compute} "
        f"({args.threads} threads)")
    model = WhisperModel(args.model, device=device, compute_type=compute,
                         cpu_threads=args.threads)

    segments, info = model.transcribe(
        str(audio),
        language=args.language,
        beam_size=args.beam_size,
        vad_filter=not args.no_vad,
        vad_parameters=dict(min_silence_duration_ms=500),
        initial_prompt=args.prompt,
    )
    log(f"      language={info.language} ({info.language_probability:.0%}) "
        f"duration={info.duration / 60:.1f} min")

    writers = Writers(base, formats)
    started = time.time()
    last_report = 0.0
    try:
        for seg in segments:
            writers.add(seg)
            if seg.end - last_report >= 60:
                last_report = seg.end
                elapsed = time.time() - started
                speed = seg.end / elapsed if elapsed else 0
                eta = (info.duration - seg.end) / speed if speed else 0
                log(f"      {seg.end / 60:5.1f} / {info.duration / 60:.1f} min "
                    f"({speed:.2f}x, ETA {eta / 60:.0f} min)")
    except KeyboardInterrupt:
        log("\nInterrupted -- partial output kept.")
    finally:
        writers.close()

    log(f"\nDone in {(time.time() - started) / 60:.1f} min. Wrote:")
    for f in formats:
        print(f"{base}.{f}")


if __name__ == "__main__":
    main()
