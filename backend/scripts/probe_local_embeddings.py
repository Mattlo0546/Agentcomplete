"""Isolated, entirely local ONNX retrieval experiment; no app credentials or network access.

Use the JSON fixture export from probe_semantic_routes.py with a separately downloaded model.
Requires numpy, onnxruntime and tokenizers. Model/tokenizer paths are explicit, never downloaded here.
"""

import argparse
import hashlib
import json
import statistics
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    data = json.loads(args.fixtures.read_text())
    ort.disable_telemetry_events()
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    started = time.perf_counter()
    session = ort.InferenceSession(
        str(args.model_dir / "onnx/model_quantized.onnx"), options, providers=["CPUExecutionProvider"]
    )
    tokenizer = Tokenizer.from_file(str(args.model_dir / "tokenizer.json"))
    # Explicit experimental bound. Never use this as evidence for arbitrary long-draft recall.
    tokenizer.enable_truncation(max_length=512)
    startup_ms = (time.perf_counter() - started) * 1000

    def embed(text: str) -> tuple[np.ndarray, float, int]:
        started = time.perf_counter()
        encoded = tokenizer.encode(text)
        inputs = {
            "input_ids": np.asarray([encoded.ids], dtype=np.int64),
            "attention_mask": np.asarray([encoded.attention_mask], dtype=np.int64),
            **{
                name: np.empty((0, 512), dtype=np.float32)
                for name in ("image_features", "video_features", "audio_features")
            },
        }
        vector = session.run(["sentence_embedding"], inputs)[0][0]
        return vector / np.linalg.norm(vector), (time.perf_counter() - started) * 1000, len(encoded.ids)

    document_vectors = []
    document_ms = []
    for row in data["rows"]:
        vector, latency, _ = embed(f"title: {row['title']} | text: {row['summary']}\n{row['body']}")
        document_vectors.append(vector)
        document_ms.append(latency)
    matrix = np.stack(document_vectors)
    results = []
    for case in data["cases"]:
        vector, latency, tokens = embed(f"task: search result | query: {case['prompt']}")
        scores = matrix @ vector
        order = np.argsort(-scores)[:3]
        slugs = [data["titles"][data["rows"][int(i)]["title"]] for i in order]
        results.append(
            {
                "case": case["name"],
                "category": case["category"],
                "embedding_ms": round(latency, 2),
                "tokens": tokens,
                "top3": slugs,
                "scores": [round(float(scores[int(i)]), 4) for i in order],
                "targets": case["targets"],
                "missing": [slug for slug in case["targets"] if slug not in slugs],
                "excluded_nominated": [slug for slug in case["excluded"] if slug in slugs],
            }
        )
    timings = [row["embedding_ms"] for row in results]
    report = {
        "model": "onnx-community/embeddinggemma-2-ONNX",
        "revision": "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
        "precision": "q8",
        "provider": "CPUExecutionProvider",
        "threads": args.threads,
        "input_token_limit": 512,
        "fixture_sha256": hashlib.sha256(args.fixtures.read_bytes()).hexdigest(),
        "startup_ms": round(startup_ms, 2),
        "index_build_ms": round(sum(document_ms), 2),
        "query_ms_median": round(statistics.median(timings), 2),
        "query_ms_min": min(timings),
        "query_ms_max": max(timings),
        "targets": sum(len(row["targets"]) for row in results),
        "targets_recalled": sum(len(row["targets"]) - len(row["missing"]) for row in results),
        "results": results,
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "results"}))


if __name__ == "__main__":
    main()
