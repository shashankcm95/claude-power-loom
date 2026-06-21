---
kb_id: bigdata-ml-cloud/jvm-machine-learning
version: 1
tags:
  - bigdata-ml-cloud
  - machine-learning
  - jvm-ml
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: deeplearning4j"
  - "Baeldung tutorials (eugenp/tutorials) module: tensorflow-java"
  - "DJL — ONNX Runtime engine (djl.ai/engines/onnxruntime/onnxruntime-engine/)"
related:
  - bigdata-ml-cloud/apache-spark
  - bigdata-ml-cloud/blockchain-ethereum
status: active
---

## Summary

**Concept**: On-JVM machine learning across three stacks — Spark MLlib (RDD-based), Deeplearning4j (declarative deep nets), and TensorFlow-Java (graph/SavedModel inference) — all sharing one pipeline shape: load → vectorize → normalize → split → train → evaluate → serialize/infer.
**Key APIs**: `LogisticRegressionWithLBFGS().setNumClasses(3)`, `MulticlassMetrics.accuracy()`; `NeuralNetConfiguration.Builder`→`MultiLayerNetwork`, `CSVRecordReader`/`ImageRecordReader`, `ModelSerializer`, `Evaluation.stats()`; TF `graph.opBuilder(...)`, `session.runner().feed(...).fetch(...).run()`, `SavedModelBundle.load("./model","serve")`.
**Gotcha**: TF-Java feed `Tensor`s aren't closed (off-heap native leak); DL4J `Utils.extractEntry` has no Zip-Slip guard; the TF Python (`z=2x+3y`) and Java (`z=3x+2y`) examples encode different constants.
**2026-currency**: DL4J sidelined (last stable 1.0.0-M2.1, Aug 2022); TF-Java 1.12 obsolete (redesigned `tensorflow-core-platform`); JVM ML serving has shifted to AWS's Deep Java Library (DJL) over ONNX Runtime/PyTorch/TensorFlow.
**Sources**: Baeldung `deeplearning4j` + `tensorflow-java` modules; DJL docs.

## Quick Reference

**The shared pipeline shape** (identical across all three stacks): data-load → vectorize → normalize → train/test split → configure → train → evaluate → serialize/infer.

**Spark MLlib** (RDD-based, supervised on Iris):
- load → `Vectors.dense` vectorize → `Statistics.colStats`/`Statistics.corr` (pearson) exploratory stats → `LabeledPoint`
- `randomSplit` 80/20 → `LogisticRegressionWithLBFGS().setNumClasses(3)` → `MulticlassMetrics.accuracy()` → `model.save`/`load` → predict

**Deeplearning4j** (DL4J/ND4J/DataVec):
- Config: `NeuralNetConfiguration.Builder` → `MultiLayerConfiguration` → `MultiLayerNetwork`
- Layers: `DenseLayer.Builder`, `ConvolutionLayer.Builder`, `SubsamplingLayer.Builder(PoolingType.MAX)`
- Models: feed-forward MLP (Iris 4→3, TANH+softmax, XAVIER, L2, neg-log-likelihood); LeNet-5 CNN (MNIST, `InputType.convolutionalFlat(28,28,1)`); deeper CIFAR CNN (Adam, MSLE, `InputType.convolutional(32,32,3)`)
- DataVec loaders: `CSVRecordReader`, `ImageRecordReader`, `NativeImageLoader`, `RecordReaderDataSetIterator`
- Normalize: `NormalizerStandardize` (z-score) vs `ImagePreProcessingScaler` (min-max); persist `ModelSerializer`; report `Evaluation.stats()`

**TensorFlow for Java** (deferred-execution graph):
- Build `Graph` of `Operation`s (`Const`, `Placeholder`, `Mul`, `Add` via `graph.opBuilder(...)`); run in a `Session` (`runner().feed(...).fetch(...).run()`)
- Load a Python-trained model: `SavedModelBundle.load("./model","serve")`
- Typed tensors: `Tensor.create(value, Class)` + `DataType.fromClass`

**Top gotchas**:
- TF-Java feed `Tensor`s aren't closed → off-heap native memory leak.
- DL4J `Utils.extractEntry` writes `folder + entry.getName()` with no path-traversal guard (Zip-Slip).
- TF Python script (`z=2x+3y`) and Java graph (`z=3x+2y`) use different constants and tensor types (Integer vs Double).

**Current (mid-2026)**: DL4J's last stable is **1.0.0-M2.1 (Aug 2022)** — even "current" is ~4 years old; the corpus's 0.9.1 pre-1.0 API (`.iterations`, `.learningRate`, `.pretrain`) is gone. TF-Java 1.12.0 is obsolete (redesigned as `tensorflow-core-platform`: `Ops`, eager execution, `TString`/`TFloat32`). The modern JVM answer is **DJL** (engine-agnostic façade over ONNX Runtime/PyTorch/TensorFlow).

## Full content

The Baeldung corpus demonstrates three independent on-JVM ML stacks, and the durable lesson is that all three follow the *same conceptual lifecycle*: data-load → vectorize → normalize → train/test split → configure → train → evaluate → serialize/infer. Only the API surfaces differ.

**Spark MLlib** is RDD-based and lives inside the Spark module. The Iris pipeline loads data, vectorizes with `Vectors.dense`, runs exploratory statistics (`Statistics.colStats`, pearson `Statistics.corr`), wraps rows as `LabeledPoint`, does an 80/20 `randomSplit`, trains a `LogisticRegressionWithLBFGS().setNumClasses(3)`, scores with `MulticlassMetrics.accuracy()`, and persists via `model.save`/`load`.

**Deeplearning4j** is the most code-complete deep-learning stack here. Networks are declared functionally: `NeuralNetConfiguration.Builder` → `MultiLayerConfiguration` → `MultiLayerNetwork`, composed from `DenseLayer.Builder`, `ConvolutionLayer.Builder`, and `SubsamplingLayer.Builder(PoolingType.MAX)`. The module shows three architectures: a feed-forward Iris MLP (TANH hidden + softmax, XAVIER init, L2, negative-log-likelihood loss), a LeNet-5 CNN for MNIST (`InputType.convolutionalFlat(28,28,1)`, Nesterovs), and a deeper CIFAR CNN (Adam, MSLE, `InputType.convolutional(32,32,3)`). DataVec handles loading (`CSVRecordReader`, `ImageRecordReader`, `NativeImageLoader`, `RecordReaderDataSetIterator`) and normalization (`NormalizerStandardize` z-score vs `ImagePreProcessingScaler` min-max). Models persist through `ModelSerializer` and report via `Evaluation.stats()`.

**TensorFlow for Java** demonstrates the deferred-execution graph model: build a `Graph` of `Operation`s (`Const`, `Placeholder`, `Mul`, `Add` through `graph.opBuilder(...)`) and execute inside a `Session` with `runner().feed(...).fetch(...).run()`. The inference side loads a Python-trained model via `SavedModelBundle.load("./model","serve")`, with typed tensors built through `Tensor.create(value, Class)` and `DataType.fromClass`.

The corpus has several teaching foot-guns: TF-Java feed `Tensor`s are never closed (off-heap native leak), DL4J's archive extraction has no Zip-Slip protection, and the TF Python/Java examples disagree on both the encoded formula and the tensor types.

### 2026 currency

**DL4J is sidelined.** Its last tagged stable is **1.0.0-M2.1 (Aug 17, 2022)** — the corpus's 0.9.1 (2017) pre-1.0 API (`.iterations`, `.learningRate`, `.regularization`, `.pretrain`, `.backprop`) is all removed/renamed in 1.0.0-beta+ (LR moved into updaters), and even the current release is ~4 years stale ([Deeplearning4j (Wikipedia)](https://en.wikipedia.org/wiki/Deeplearning4j) · [Eclipse Deeplearning4j (deeplearning4j.konduit.ai)](https://deeplearning4j.konduit.ai/)).

**TensorFlow Java 1.12.0 is obsolete** — the entire API was redesigned as `tensorflow-core-platform` (`Ops`, eager execution, `TString`/`TFloat32`), and the companion Python script targets TF 1.x (`tf.placeholder`/`tf.Session`/`SavedModelBuilder`, all removed in TF 2.x).

The modern JVM ML serving answer is **AWS's Deep Java Library (DJL)** — an engine-agnostic façade that runs **ONNX Runtime** (CPU inference), PyTorch, and TensorFlow with no code change to switch engines ([DJL — ONNX Runtime engine (djl.ai)](http://djl.ai/engines/onnxruntime/onnxruntime-engine/) · [Simplified MLOps with DJL (AWS ML Blog)](https://aws.amazon.com/blogs/machine-learning/simplified-mlops-with-deep-java-library/)). The **Zip-Slip** in DL4J `Utils.extractEntry` is the generic path-traversal class (no DL4J-specific CVE); mitigate by canonicalizing each entry path and verifying it stays within the target dir before writing.
