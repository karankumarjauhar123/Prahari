#!/usr/bin/env python3
"""
scripts/benchmark.py
Run inference speed benchmarks on all PRAHARI models.
Tests on CPU (simulated mid-range device conditions).

Requirements: pip install tensorflow numpy pillow
Run: python scripts/benchmark.py
"""

import os, time, statistics
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(ROOT, "models")

RUNS = 50  # Number of inference runs per model

def run_tflite_benchmark(model_path: str, input_shape: list, runs: int = RUNS):
    """Run N inferences and return timing stats in milliseconds."""
    try:
        import tensorflow as tf
        interpreter = tf.lite.Interpreter(model_path=model_path, num_threads=4)
        interpreter.allocate_tensors()

        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()

        # Determine input dtype
        dtype = input_details[0]['dtype']
        if dtype == np.int8:
            dummy = np.random.randint(-128, 127, input_shape, dtype=np.int8)
        else:
            dummy = np.random.rand(*input_shape).astype(np.float32)

        # Warm up — 5 runs
        for _ in range(5):
            interpreter.set_tensor(input_details[0]['index'], dummy)
            interpreter.invoke()

        # Benchmark runs
        times = []
        for _ in range(runs):
            start = time.perf_counter()
            interpreter.set_tensor(input_details[0]['index'], dummy)
            interpreter.invoke()
            times.append((time.perf_counter() - start) * 1000)

        return {
            "avg_ms": round(statistics.mean(times), 1),
            "min_ms": round(min(times), 1),
            "max_ms": round(max(times), 1),
            "std_ms": round(statistics.stdev(times), 1),
            "p95_ms": round(sorted(times)[int(runs * 0.95)], 1),
        }
    except Exception as e:
        return {"error": str(e)}

def get_model_size_mb(path: str) -> float:
    if os.path.exists(path):
        return round(os.path.getsize(path) / 1024 / 1024, 2)
    return 0.0

def main():
    print("\n" + "═"*62)
    print("  PRAHARI — Inference Benchmark")
    print(f"  {RUNS} runs per model | CPU | 4 threads")
    print("═"*62)

    models = [
        {
            "name": "YOLOv8-face Nano (INT8)",
            "file": "yolov8_face_nano_int8.tflite",
            "input": [1, 320, 320, 3],
            "stage": "Face Detection",
            "target_ms": 50,
        },
        {
            "name": "MediaPipe Face Mesh Lite",
            "file": "face_mesh_lite.tflite",
            "input": [1, 192, 192, 3],
            "stage": "Liveness (Mesh)",
            "target_ms": 60,
        },
        {
            "name": "Anti-Spoof MobileNet (INT8)",
            "file": "antispoof_mobilenet_int8.tflite",
            "input": [1, 80, 80, 3],
            "stage": "Liveness (Passive)",
            "target_ms": 30,
        },
        {
            "name": "AdaFace MobileOne-S0 (INT8)",
            "file": "adaface_mobilone_s0_int8.tflite",
            "input": [1, 112, 112, 3],
            "stage": "Face Recognition",
            "target_ms": 250,
        },
    ]

    total_avg = 0
    results = []

    for m in models:
        path = os.path.join(MODELS_DIR, m["file"])
        size = get_model_size_mb(path)

        print(f"\n▶  {m['name']}")
        print(f"   Stage: {m['stage']}  |  Size: {size} MB")

        if not os.path.exists(path):
            print(f"   ⚠️  Model not found — run download_models.py first")
            continue

        stats = run_tflite_benchmark(path, m["input"])

        if "error" in stats:
            print(f"   ❌ Error: {stats['error']}")
            continue

        status = "✅" if stats["avg_ms"] <= m["target_ms"] else "⚠️"
        print(f"   avg: {stats['avg_ms']}ms  min: {stats['min_ms']}ms  "
              f"max: {stats['max_ms']}ms  p95: {stats['p95_ms']}ms  {status}")
        print(f"   Target: <{m['target_ms']}ms")

        total_avg += stats["avg_ms"]
        results.append({**m, **stats, "size_mb": size})

    print("\n" + "═"*62)
    print(f"  PIPELINE TOTAL (avg): {round(total_avg, 1)} ms")
    if total_avg > 0:
        status = "✅ PASS" if total_avg < 1000 else "❌ FAIL"
        print(f"  TARGET (<1000ms):     {status}")
    print()

    # Model size summary
    total_size = sum(r.get("size_mb", 0) for r in results)
    print(f"  TOTAL MODEL SIZE: {total_size:.1f} MB / 20 MB limit  "
          f"{'✅' if total_size < 20 else '❌'}")

    print("═"*62)
    print()

    # Device recommendation table
    print("  ESTIMATED PERFORMANCE BY DEVICE CLASS")
    print("  " + "-"*56)
    print(f"  {'Device':<30} {'Total ms':<12} {'Status'}")
    print("  " + "-"*56)

    devices = [
        ("Redmi Note 11 (Snapdragon 680)", 0.9),
        ("Realme C35 (Unisoc T616)",       1.15),
        ("Samsung Galaxy A23 (Helio G85)", 0.95),
        ("OnePlus Nord CE 2 (D900)",       0.75),
        ("Poco M4 Pro (Helio G96)",        0.85),
        ("iPhone SE 2022 (A15)",           0.35),
        ("iPhone 12 (A14)",                0.30),
    ]

    for name, multiplier in devices:
        est = round(total_avg * multiplier) if total_avg > 0 else "N/A"
        status = "✅" if isinstance(est, int) and est < 1000 else "⚠️"
        print(f"  {name:<30} {str(est)+'ms':<12} {status}")

    print("  " + "-"*56)
    print()

if __name__ == "__main__":
    main()
