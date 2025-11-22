import React, { useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image } from "react-native";
import { Canvas, Path, Skia, PaintStyle } from "@shopify/react-native-skia";
import * as FileSystem from "expo-file-system";

export default function CanvasDetectScreen() {
  const [paths, setPaths] = useState([]);
  const [previewUri, setPreviewUri] = useState(null);
  const [loading, setLoading] = useState(false);

  const drawPoints = useRef([]);

  const paint = Skia.Paint();
  paint.setColor(Skia.Color("#000"));
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(4);

  const handleTouch = (e) => {
    const { x, y } = e;
    drawPoints.current.push({ x, y });
  };

  const handleTouchEnd = () => {
    if (drawPoints.current.length > 1) {
      const newPath = Skia.Path.Make();
      newPath.moveTo(drawPoints.current[0].x, drawPoints.current[0].y);

      drawPoints.current.forEach((p) => newPath.lineTo(p.x, p.y));

      setPaths((prev) => [...prev, newPath]);
    }
    drawPoints.current = [];
  };

  const clearCanvas = () => {
    setPaths([]);
    setPreviewUri(null);
  };

  const sendToBackend = async () => {
    if (paths.length === 0) {
      alert("Draw something first!");
      return;
    }

    setLoading(true);

    try {
      const uri = await global.canvasRef.makeImageSnapshot().toDataURL();
      setPreviewUri(uri);

      const base64 = uri.replace("data:image/png;base64,", "");

      const response = await fetch("http://YOUR_BACKEND_URL/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 })
      });

      const result = await response.json();

      Alert.alert("Result", result.prediction);
    } catch (err) {
      console.log(err);
      Alert.alert("Error", "Could not send image");
    }

    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Handwriting Test</Text>
      <Text style={styles.sub}>Write anything naturally. We’ll analyze tremor patterns.</Text>

      <View style={styles.canvasWrap}>
        <Canvas
          style={styles.canvas}
          ref={(ref) => (global.canvasRef = ref)}
          onTouchStart={handleTouch}
          onTouchMove={handleTouch}
          onTouchEnd={handleTouchEnd}
        >
          {paths.map((p, i) => (
            <Path key={i} path={p} paint={paint} />
          ))}
        </Canvas>
      </View>

      {previewUri && (
        <Image source={{ uri: previewUri }} style={styles.preview} />
      )}

      {loading ? (
        <ActivityIndicator size="large" color="blue" />
      ) : (
        <View style={styles.btnRow}>
          <TouchableOpacity onPress={clearCanvas} style={[styles.btn, styles.clear]}>
            <Text style={styles.btnText}>Clear</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={sendToBackend} style={[styles.btn, styles.detect]}>
            <Text style={styles.btnText}>Detect</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#fff"
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 5
  },
  sub: {
    fontSize: 14,
    color: "#666",
    marginBottom: 10
  },
  canvasWrap: {
    backgroundColor: "#f3f3f3",
    borderRadius: 15,
    borderColor: "#ccc",
    borderWidth: 1,
    height: 350,
    overflow: "hidden",
    marginBottom: 15
  },
  canvas: {
    flex: 1
  },
  btnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10
  },
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 25,
    borderRadius: 10
  },
  clear: {
    backgroundColor: "#999"
  },
  detect: {
    backgroundColor: "#0066FF"
  },
  btnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700"
  },
  preview: {
    width: "100%",
    height: 120,
    borderRadius: 10,
    marginBottom: 10
  }
});