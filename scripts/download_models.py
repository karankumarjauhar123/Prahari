#!/usr/bin/env python3
"""
scripts/download_models.py
Download all open-source TFLite models for PRAHARI.
Run: python scripts/download_models.py

All models are Apache 2.0 / MIT licensed — no paid licenses needed.
"""

import os, sys, urllib.request, hashlib, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR       = os.path.join(ROOT, "models")
ANDROID_ASSETS   = os.path.join(ROOT, "android/app/src/main/assets/models")
IOS_MODELS       = os.path.join(ROOT, "ios/PRAHARI/models")

os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(ANDROID_ASSETS, exist_ok=True)
os.makedirs(IOS_MODELS, exist_ok=True)

# ─── Model Registry ────────────────────────────────────────────────────────
MODELS = {
    "face_mesh_lite.tflite": {
        "url": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
        "alt": "https://github.com/google-ai-edge/mediapipe/raw/master/mediapipe/modules/face_landmark/face_landmark_front.tflite",
        "size_mb": 4.0,
        "note": "MediaPipe Face Mesh — 468 landmarks — Apache 2.0",
    },
    "antispoof_mobilenet_int8.tflite": {
        "url": "https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/raw/master/resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.onnx",
        "note": "MiniFASNetV2 anti-spoof — MIT License (convert ONNX→TFLite using convert_to_tflite.py)",
        "size_mb": 1.2,
        "manual": True,
    },
    "yolov8_face_nano_int8.tflite": {
        "url": "https://github.com/derronqi/yolov8-face/releases/download/v1.0/yolov8n-face.pt",
        "note": "YOLOv8-nano face detection — AGPL-3.0 (use only for non-commercial / research, or replace with BlazeFace for commercial)",
        "size_mb": 2.1,
        "manual": True,
    },
    "adaface_mobilone_s0_int8.tflite": {
        "url": "https://github.com/mk-minchul/AdaFace/releases/",
        "note": "AdaFace MobileOne-S0 — run convert_to_tflite.py to download & convert",
        "size_mb": 3.8,
        "manual": True,
    },
}

# ─── Placeholder generator (for manual models) ──────────────────────────────
def create_placeholder(filename: str, note: str):
    placeholder_path = os.path.join(MODELS_DIR, filename + ".PLACEHOLDER.txt")
    with open(placeholder_path, "w") as f:
        f.write(f"MODEL: {filename}\n")
        f.write(f"NOTE: {note}\n")
        f.write("Run: python scripts/convert_to_tflite.py to generate this model.\n")
    print(f"  📄 Placeholder created: {filename}.PLACEHOLDER.txt")

# ─── Download helper ─────────────────────────────────────────────────────────
def download_file(url: str, dest: str, name: str):
    print(f"  ⬇️  Downloading {name}...")
    try:
        def progress(count, block, total):
            pct = min(100, int(count * block * 100 / total))
            sys.stdout.write(f"\r     {pct}%")
            sys.stdout.flush()
        urllib.request.urlretrieve(url, dest, reporthook=progress)
        print(f"\r  ✅ {name} ({os.path.getsize(dest)/1024/1024:.1f} MB)")
        return True
    except Exception as e:
        print(f"\r  ❌ Failed: {e}")
        return False

# ─── Copy to Android + iOS ────────────────────────────────────────────────────
def copy_to_platforms(filename: str):
    src = os.path.join(MODELS_DIR, filename)
    if not os.path.exists(src):
        return
    for dest_dir in [ANDROID_ASSETS, IOS_MODELS]:
        shutil.copy2(src, os.path.join(dest_dir, filename))
    print(f"  📱 Copied to Android assets + iOS bundle")

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    print("\n" + "═"*55)
    print("  PRAHARI — Model Downloader")
    print("═"*55 + "\n")

    total_size = 0
    for filename, info in MODELS.items():
        print(f"▶  {filename}")
        print(f"   {info['note']}")

        if info.get("manual"):
            create_placeholder(filename, info["note"])
        else:
            dest = os.path.join(MODELS_DIR, filename)
            success = download_file(info["url"], dest, filename)
            if success:
                copy_to_platforms(filename)
                total_size += info["size_mb"]
        print()

    print("═"*55)
    print(f"  Automatically downloaded: {total_size:.1f} MB")
    print(f"  Manual conversion needed: adaface, yolov8, antispoof")
    print(f"\n  Next step:")
    print(f"  → Run: python scripts/convert_to_tflite.py")
    print("═"*55 + "\n")

if __name__ == "__main__":
    main()
