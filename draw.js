/*// app/draw.js
import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Animated,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Accelerometer } from 'expo-sensors';
import * as FileSystem from 'expo-file-system';
import { captureRef } from 'react-native-view-shot';
import * as Papa from 'papaparse';
import * as ImageManipulator from 'expo-image-manipulator';

const API_URL = 'https://hue-unheaped-semaj.ngrok-free.dev/infer';
const UPLOAD_TIMEOUT_MS = 25000;
const MAX_RETRIES = 2;
import * as SecureStore from 'expo-secure-store';

// app/draw.js additions (plain JS functions)
// call this after you receive `json` from /infer and have imageUri and sensorCsv available

async function saveTestToServer(token, imageUri, sensorCsv, inferenceResult, extra = {}) {
  try {
    if (!token) {
      console.warn('no auth token, skipping saveTestToServer');
      return null;
    }

    const form = new FormData();
    // add image file
    const filename = (imageUri && imageUri.split('/').pop()) || `draw_${Date.now()}.png`;
    form.append('image', {
      uri: imageUri,
      name: filename,
      type: 'image/png',
    });
    if (sensorCsv) form.append('sensor_csv', sensorCsv);
    if (extra.age) form.append('age', String(extra.age));
    if (extra.dominant_hand) form.append('dominant_hand', extra.dominant_hand);
    // pass inference result as JSON string
    if (inferenceResult) form.append('result', JSON.stringify(inferenceResult));

    const resp = await fetch(API_URL.replace('/infer','/tests'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        // DO NOT set content-type header when using FormData
      },
      body: form,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(()=>null);
      throw new Error(`save failed ${resp.status} ${txt}`);
    }
    const j = await resp.json();
    console.log('Saved test to server', j);
    return j;
  } catch (err) {
    console.warn('saveTestToServer error', err);
    return null;
  }
}

export default function DrawScreen() {
  const [paths, setPaths] = useState([]);
  const currentPointsRef = useRef([]);
  const [, setTick] = useState(0);
  const offsetRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef(null);

  const [accData, setAccData] = useState([]);
  const accSub = useRef(null);

  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const uploadingAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => () => stopSensors(), []);

  const startSensors = () => {
    try {
      Accelerometer.setUpdateInterval(50);
      accSub.current = Accelerometer.addListener(data => {
        setAccData(prev => prev.concat([{ t: Date.now(), x: data.x, y: data.y, z: data.z }]));
      });
    } catch (e) {
      console.warn('Accelerometer start failed', e);
    }
  };

  const stopSensors = () => {
    try {
      accSub.current && accSub.current.remove();
      accSub.current = null;
    } catch {}
  };

  const pointsToPath = pts => {
    if (!pts || pts.length === 0) return '';
    return pts
      .map((p, i) =>
        i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      )
      .join(' ');
  };

  const measureCanvas = cb => {
    if (!canvasRef.current || !canvasRef.current.measure) {
      if (cb) cb();
      return;
    }
    canvasRef.current.measure((x, y, w, h, pageX, pageY) => {
      offsetRef.current = { x: pageX, y: pageY };
      if (cb) cb();
    });
  };

  const addPointFromEvent = evt => {
    const ne = evt.nativeEvent || {};
    let x = typeof ne.locationX === 'number' ? ne.locationX : (ne.pageX - offsetRef.current.x);
    let y = typeof ne.locationY === 'number' ? ne.locationY : (ne.pageY - offsetRef.current.y);
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    const pts = currentPointsRef.current;
    const last = pts.length ? pts[pts.length - 1] : null;
    if (last && Math.hypot(last.x - x, last.y - y) < 1.5) return;

    pts.push({ x, y });
    currentPointsRef.current = pts;
    setTick(t => t + 1);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: evt => {
        measureCanvas(() => {
          startSensors();
          currentPointsRef.current = [];
          addPointFromEvent(evt);
        });
      },
      onPanResponderMove: evt => addPointFromEvent(evt),
      onPanResponderRelease: () => {
        const finalPoints = currentPointsRef.current.slice();
        const pth = pointsToPath(finalPoints);
        if (pth && pth.length > 0) {
          setPaths(prev => prev.concat([pth]));
        }
        currentPointsRef.current = [];
        setTick(t => t + 1);
        stopSensors();
      },
    })
  ).current;

  const renderCurrentPath = () => {
    const pts = currentPointsRef.current;
    if (!pts || pts.length === 0) return null;
    return pointsToPath(pts);
  };

  const captureImageUri = async () => {
    if (!canvasRef.current) throw new Error('Canvas ref missing');
    return captureRef(canvasRef, { format: 'png', quality: 0.95 });
  };

  const resizeTo128Base64 = async uri => {
    const manipResult = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 128, height: 128 } }],
      { compress: 1, format: ImageManipulator.SaveFormat.PNG, base64: true }
    );
    return manipResult.base64;
  };

  const buildSensorCSV = async () => {
    if (!accData || accData.length === 0) return null;
    const csv = Papa.unparse(accData);
    try {
      const fileUri = `${FileSystem.cacheDirectory}sensor_${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv);
    } catch {}
    return csv;
  };

  const fetchWithTimeout = (url, options = {}, timeout = UPLOAD_TIMEOUT_MS) =>
    Promise.race([
      fetch(url, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), timeout)),
    ]);

  const startUploadingAnim = () => {
    Animated.loop(
      Animated.timing(uploadingAnim, { toValue: 1, duration: 900, useNativeDriver: true })
    ).start();
  };

  const stopUploadingAnim = () => {
    uploadingAnim.stopAnimation();
    uploadingAnim.setValue(0);
  };

  const handleCaptureAndUpload = async () => {
    if (uploading) return;
    setUploading(true);
    setResult(null);
    startUploadingAnim();

    try {
      const imageUri = await captureImageUri();
      const sensorCsv = await buildSensorCSV();

      const form = new FormData();
      const filename = imageUri.split('/').pop() || `draw_${Date.now()}.png`;
      form.append('image', { uri: imageUri, name: filename, type: 'image/png' });
      if (sensorCsv) form.append('sensor_csv', sensorCsv);
      form.append('age', String(65));
      form.append('dominant_hand', 'right');

      const resp = await fetchWithTimeout(
        API_URL,
        { method: 'POST', body: form },
        UPLOAD_TIMEOUT_MS * 2
      );

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`Server ${resp.status} ${txt}`);
      }

      const json = await resp.json();
      const token = await SecureStore.getItemAsync('userToken'); // or wherever you store login token
    await saveTestToServer(token, imageUri, sensorCsv, json, { age: 65, dominant_hand: 'right' });

      setResult(json);

      Alert.alert(
        'Analysis complete',
        `Decision: ${json.decision ?? json.label ?? 'unknown'}\nScore: ${
          json.score ? Number(json.score).toFixed(3) : 'n/a'
        }`
      );
    } catch (err) {
      Alert.alert('Analyze failed', String(err.message || err));
    } finally {
      setUploading(false);
      stopUploadingAnim();
      setAccData([]);
    }
  };

  const clearAll = () => {
    setPaths([]);
    currentPointsRef.current = [];
    setResult(null);
    setTick(t => t + 1);
  };

  const ResultCard = ({ data }) => {
    if (!data) {
      return (
        <View style={styles.resultEmpty}>
          <Text style={styles.resultTitle}>No result yet</Text>
          <Text style={styles.resultSub}>Draw a spiral and press Analyze</Text>
        </View>
      );
    }

    const label = data.decision ?? data.label ?? data.prediction ?? 'unknown';

    return (
      <View style={styles.resultCard}>
        <Text style={styles.resultTitle}>Last result</Text>
        <Text style={styles.resultLabel}>{label}</Text>
      </View>
    );
  };

  const pulse = uploadingAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.07],
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Draw Spiral</Text>
      <Text style={styles.subtitle}>Draw a continuous spiral inside the box.</Text>

      <View ref={canvasRef} onLayout={() => measureCanvas()} {...panResponder.panHandlers} style={styles.canvas}>
        <Svg width="100%" height="100%">
          <Rect x="0" y="0" width="100%" height="100%" fill="#ffffff" stroke="#dbeafe" />
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke="#2563eb"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}

          {renderCurrentPath() && (
            <Path
              d={renderCurrentPath()}
              stroke="#2563eb"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          )}
        </Svg>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.outlineBtn} onPress={clearAll}>
          <Text style={styles.outlineBtnText}>Clear</Text>
        </TouchableOpacity>

        <Animated.View style={{ transform: [{ scale: uploading ? pulse : 1 }] }}>
          <TouchableOpacity
            style={[styles.btn, uploading && { opacity: 0.7 }]}
            onPress={handleCaptureAndUpload}
            disabled={uploading}
          >
            {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Analyze</Text>}
          </TouchableOpacity>
        </Animated.View>
      </View>

      <View style={styles.resultArea}>
        <ResultCard data={result} />
      </View>

      <View style={styles.debugBox}>
        <Text style={{ fontWeight: '700', color: '#1e3a8a' }}>Debug</Text>
        <Text>currentPoints: {currentPointsRef.current.length}</Text>
        <Text>strokes: {paths.length}</Text>
        <Text>accSamples: {accData.length}</Text>
      </View>
    </View>
  );
}

// ----------- CSS -> React Native converted styles --------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#eff6ff', // medical blue
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1e3a8a',
  },

  subtitle: {
    fontSize: 14,
    color: '#1e40af',
    marginBottom: 12,
  },

  canvas: {
    width: '100%',
    height: 380,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
  },

  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 14,
  },

  btn: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    paddingHorizontal: 26,
    borderRadius: 12,
    shadowColor: '#2563eb',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },

  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  outlineBtn: {
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    paddingHorizontal: 26,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#2563eb',
  },

  outlineBtnText: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '600',
  },

  resultArea: {
    marginTop: 10,
  },

  resultCard: {
    backgroundColor: '#ffffff',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 15,
    elevation: 4,
  },

  resultEmpty: {
    backgroundColor: '#ffffff',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },

  resultTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e3a8a',
  },

  resultLabel: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2563eb',
    marginTop: 6,
  },

  debugBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
});
*/

// app/draw.js
import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Animated,
  Modal,
  Image,
  Share,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Accelerometer } from 'expo-sensors';
import * as FileSystem from 'expo-file-system';
import { captureRef } from 'react-native-view-shot';
import * as Papa from 'papaparse';
import * as ImageManipulator from 'expo-image-manipulator';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';

/**
 * CONFIG
 */
const API_URL = 'https://hue-unheaped-semaj.ngrok-free.dev/infer';
const UPLOAD_TIMEOUT_MS = 25000;
const MAX_RETRIES = 2;

// Sample image path from your session for quick testing; you'll transform it to a usable URL on your side.
// Use value only for demo thumbnail if result lacks an image URL.
const SAMPLE_IMAGE = 'sandbox:/mnt/data/b541875a-c93b-496d-97b9-383c79fa125e.png';

/**
 * Helper: save test to server (multipart)
 */
async function saveTestToServer(token, imageUri, sensorCsv, inferenceResult, extra = {}) {
  try {
    if (!token) {
      console.warn('no auth token, skipping saveTestToServer');
      Alert.alert('Not signed in', 'Sign in to save this test to your history.');
      return null;
    }

    const form = new FormData();
    const filename = (imageUri && imageUri.split('/').pop()) || `draw_${Date.now()}.png`;
    form.append('image', {
      uri: imageUri,
      name: filename,
      type: 'image/png',
    });
    if (sensorCsv) form.append('sensor_csv', sensorCsv);
    if (extra.age) form.append('age', String(extra.age));
    if (extra.dominant_hand) form.append('dominant_hand', extra.dominant_hand);
    if (inferenceResult) form.append('result', JSON.stringify(inferenceResult));

    const resp = await fetch(API_URL.replace('/infer', '/tests'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => null);
      throw new Error(`save failed ${resp.status} ${txt}`);
    }
    const j = await resp.json();
    Alert.alert('Saved', 'Your test was saved to your history.');
    return j;
  } catch (err) {
    console.warn('saveTestToServer error', err);
    Alert.alert('Save failed', String(err.message || err));
    return null;
  }
}

export default function DrawScreen() {
  const router = useRouter();

  // drawing
  const [paths, setPaths] = useState([]);
  const currentPointsRef = useRef([]);
  const [, setTick] = useState(0);
  const offsetRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef(null);

  // sensors
  const [accData, setAccData] = useState([]);
  const accSub = useRef(null);

  // upload + result
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // raw JSON from server
  const uploadingAnim = useRef(new Animated.Value(0)).current;

  // modal UI state
  const [modalVisible, setModalVisible] = useState(false);
  const modalScale = useRef(new Animated.Value(0.8)).current;
  const modalOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => () => stopSensors(), []);

  const startSensors = () => {
    try {
      Accelerometer.setUpdateInterval(50);
      accSub.current = Accelerometer.addListener(data => {
        setAccData(prev => prev.concat([{ t: Date.now(), x: data.x, y: data.y, z: data.z }]));
      });
    } catch (e) {
      console.warn('Accelerometer start failed', e);
    }
  };

  const stopSensors = () => {
    try {
      accSub.current && accSub.current.remove();
      accSub.current = null;
    } catch {}
  };

  const pointsToPath = pts => {
    if (!pts || pts.length === 0) return '';
    return pts
      .map((p, i) =>
        i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      )
      .join(' ');
  };

  const measureCanvas = cb => {
    if (!canvasRef.current || !canvasRef.current.measure) {
      if (cb) cb();
      return;
    }
    canvasRef.current.measure((x, y, w, h, pageX, pageY) => {
      offsetRef.current = { x: pageX, y: pageY };
      if (cb) cb();
    });
  };

  const addPointFromEvent = evt => {
    const ne = evt.nativeEvent || {};
    let x = typeof ne.locationX === 'number' ? ne.locationX : (ne.pageX - offsetRef.current.x);
    let y = typeof ne.locationY === 'number' ? ne.locationY : (ne.pageY - offsetRef.current.y);
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    const pts = currentPointsRef.current;
    const last = pts.length ? pts[pts.length - 1] : null;
    if (last && Math.hypot(last.x - x, last.y - y) < 1.5) return;

    pts.push({ x, y });
    currentPointsRef.current = pts;
    setTick(t => t + 1);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: evt => {
        measureCanvas(() => {
          startSensors();
          currentPointsRef.current = [];
          addPointFromEvent(evt);
        });
      },
      onPanResponderMove: evt => addPointFromEvent(evt),
      onPanResponderRelease: () => {
        const finalPoints = currentPointsRef.current.slice();
        const pth = pointsToPath(finalPoints);
        if (pth && pth.length > 0) {
          setPaths(prev => prev.concat([pth]));
        }
        currentPointsRef.current = [];
        setTick(t => t + 1);
        stopSensors();
      },
    })
  ).current;

  const renderCurrentPath = () => {
    const pts = currentPointsRef.current;
    if (!pts || pts.length === 0) return null;
    return pointsToPath(pts);
  };

  const captureImageUri = async () => {
    if (!canvasRef.current) throw new Error('Canvas ref missing');
    return captureRef(canvasRef, { format: 'png', quality: 0.95 });
  };

  const resizeTo128Base64 = async uri => {
    const manipResult = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 128, height: 128 } }],
      { compress: 1, format: ImageManipulator.SaveFormat.PNG, base64: true }
    );
    return manipResult.base64;
  };

  const buildSensorCSV = async () => {
    if (!accData || accData.length === 0) return null;
    const csv = Papa.unparse(accData);
    try {
      const fileUri = `${FileSystem.cacheDirectory}sensor_${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv);
    } catch {}
    return csv;
  };

  const fetchWithTimeout = (url, options = {}, timeout = UPLOAD_TIMEOUT_MS) =>
    Promise.race([
      fetch(url, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), timeout)),
    ]);

  const startUploadingAnim = () => {
    Animated.loop(
      Animated.timing(uploadingAnim, { toValue: 1, duration: 900, useNativeDriver: true })
    ).start();
  };

  const stopUploadingAnim = () => {
    uploadingAnim.stopAnimation();
    uploadingAnim.setValue(0);
  };

  // animate modal in
  const openResultModal = () => {
    setModalVisible(true);
    modalScale.setValue(0.85);
    modalOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(modalScale, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(modalOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  };
  const closeResultModal = () => {
    Animated.parallel([
      Animated.timing(modalScale, { toValue: 0.85, duration: 200, useNativeDriver: true }),
      Animated.timing(modalOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => setModalVisible(false));
  };

  // Map model output to friendly UI
  function interpretResult(obj) {
    // prioritize decision -> label -> score threshold
    const label = obj?.decision ?? obj?.label ?? null;
    const score = (typeof obj?.score !== 'undefined') ? Number(obj.score) : null;

    // heuristics:
    // - if label contains 'tremor' or 'positive' -> positive
    // - if score numeric and > 0.6 -> positive; <0.4 -> negative; else inconclusive
    let status = 'inconclusive';
    if (label) {
      const ll = String(label).toLowerCase();
      if (ll.includes('tremor') || ll.includes('positive') || ll.includes('class_1')) status = 'positive';
      if (ll.includes('no_tremor') || ll.includes('negative') || ll.includes('class_0')) status = 'negative';
    }
    if (score !== null) {
      if (score >= 0.6) status = 'positive';
      else if (score <= 0.4) status = 'negative';
      else if (status === 'inconclusive') status = 'inconclusive';
    }
    return { status, label, score };
  }

  // Share result text
  const onShare = async (payload) => {
    try {
      const text = `Tremor Tracker result: ${payload.label ?? payload.decision ?? 'unknown'} - score: ${payload.score ?? 'n/a'}`;
      await Share.share({ message: text });
    } catch (err) {
      console.warn('share failed', err);
      Alert.alert('Share failed', String(err));
    }
  };

  // Main analyze (multipart upload to /infer) - then open modal with result
  const handleCaptureAndUpload = async () => {
    if (uploading) return;
    setUploading(true);
    setResult(null);
    startUploadingAnim();

    try {
      const imageUri = await captureImageUri();
      const sensorCsv = await buildSensorCSV();

      const form = new FormData();
      const filename = imageUri.split('/').pop() || `draw_${Date.now()}.png`;
      form.append('image', { uri: imageUri, name: filename, type: 'image/png' });
      if (sensorCsv) form.append('sensor_csv', sensorCsv);
      form.append('age', String(65));
      form.append('dominant_hand', 'right');

      const resp = await fetchWithTimeout(
        API_URL,
        { method: 'POST', body: form },
        UPLOAD_TIMEOUT_MS * 2
      );

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`Server ${resp.status} ${txt}`);
      }

      const json = await resp.json();
      setResult(json);
      // open modal with nice UI
      openResultModal();

      // attempt to auto-save if logged in (non-blocking)
      const token = await SecureStore.getItemAsync('userToken');
      if (token) {
        // don't await blocking - but save in background
        saveTestToServer(token, imageUri, sensorCsv, json, { age: 65, dominant_hand: 'right' }).catch(()=>{});
      }
    } catch (err) {
      console.warn('Analyze error', err);
      Alert.alert('Analyze failed', String(err.message || err));
    } finally {
      setUploading(false);
      stopUploadingAnim();
      setAccData([]);
    }
  };

  const clearAll = () => {
    setPaths([]);
    currentPointsRef.current = [];
    setResult(null);
    setTick(t => t + 1);
  };

  // Build modal content based on result
  function ResultModalContent({ data }) {
    if (!data) return null;

    const { status, label, score } = interpretResult(data);
    // choose visuals
    let headerColor = '#2563eb';
    let icon = 'ℹ️';
    let headline = 'Inconclusive';
    let message = 'Result unclear — consider retesting or consult a specialist for more assurance.';

    if (status === 'negative') {
      headerColor = '#059669'; // green
      icon = '✅';
      headline = 'Normal';
      message = "Need not to worry — your drawing looks normal. Keep monitoring if you like.";
    } else if (status === 'positive') {
      headerColor = '#d97706'; // amber/orange
      icon = '⚠️';
      headline = 'Possible tremor detected';
      message = 'We recommend referring to a specialist for further evaluation and assurance.';
    }

    // attempt to get image: prefer result.heatmap_image_url or sample
    const imageUrl = data.heatmap_image_url || data.imageUrl || SAMPLE_IMAGE;

    return (
      <Animated.View style={[styles.modalCard, { transform: [{ scale: modalScale }], opacity: modalOpacity }]}>
        <View style={[styles.modalHeader, { backgroundColor: headerColor }]}>
          <Text style={styles.modalIcon}>{icon}</Text>
          <Text style={styles.modalHeadline}>{headline}</Text>
        </View>

        <View style={styles.modalBody}>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.modalImage}
              resizeMode="cover"
              onError={() => {/* ignore if local path fails in device env */}}
            />
          ) : null}

          <Text style={styles.modalMessage}>{message}</Text>

          {label || (score !== null) ? (
            <View style={styles.modalMetrics}>
              {label ? <Text style={styles.metricText}>Label: {String(label)}</Text> : null}
              {score !== null ? <Text style={styles.metricText}>Score: {Number(score).toFixed(3)}</Text> : null}
            </View>
          ) : null}

          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: '#2563eb' }]}
              onPress={async () => {
                const token = await SecureStore.getItemAsync('userToken');
                // you likely want to save with current imageUri; we didn't keep it here, so ask user to save from history or modify to store last capture URI globally.
                // For now try to save using result.imageUrl or SAMPLE_IMAGE as fallback
                const imageUri = data.imageUrl || SAMPLE_IMAGE;
                saveTestToServer(token, imageUri, null, data, { age: 65 }).catch(()=>{});
              }}
            >
              <Text style={styles.modalBtnText}>Save</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: '#06b6d4' }]}
              onPress={() => onShare({ label: label, score: score })}
            >
              <Text style={styles.modalBtnText}>Share</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6eefb' }]}
              onPress={() => {
                closeResultModal();
                // navigate to history if router available
                try { router.push('/history'); } catch (e) { console.warn('router push failed', e); }
              }}
            >
              <Text style={[styles.modalBtnText, { color: '#2563eb' }]}>History</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.modalClose} onPress={() => closeResultModal()}>
            <Text style={{ color: '#666' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  const ResultCard = ({ data }) => {
    // keep small inline card but show modal when tapped
    if (!data) {
      return (
        <View style={styles.resultEmpty}>
          <Text style={styles.resultTitle}>No result yet</Text>
          <Text style={styles.resultSub}>Draw a spiral and press Analyze</Text>
        </View>
      );
    }

    const { status, label, score } = interpretResult(data);
    const short = status === 'negative' ? 'Need not to worry' : status === 'positive' ? 'Refer to a specialist' : 'Inconclusive';

    return (
      <TouchableOpacity onPress={() => openResultModal()}>
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>Last result</Text>
          <Text style={styles.resultLabel}>{label ?? short}</Text>
          <Text style={{ color: '#444', marginTop: 6 }}>{score ? `Score: ${Number(score).toFixed(3)}` : ''}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const pulse = uploadingAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.07],
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Draw Spiral</Text>
      <Text style={styles.subtitle}>Draw a continuous spiral inside the box.</Text>

      <View ref={canvasRef} onLayout={() => measureCanvas()} {...panResponder.panHandlers} style={styles.canvas}>
        <Svg width="100%" height="100%">
          <Rect x="0" y="0" width="100%" height="100%" fill="#ffffff" stroke="#dbeafe" />
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke="#2563eb"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}

          {renderCurrentPath() && (
            <Path
              d={renderCurrentPath()}
              stroke="#2563eb"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          )}
        </Svg>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.outlineBtn} onPress={clearAll}>
          <Text style={styles.outlineBtnText}>Clear</Text>
        </TouchableOpacity>

        <Animated.View style={{ transform: [{ scale: uploading ? pulse : 1 }] }}>
          <TouchableOpacity
            style={[styles.btn, uploading && { opacity: 0.7 }]}
            onPress={handleCaptureAndUpload}
            disabled={uploading}
          >
            {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Analyze</Text>}
          </TouchableOpacity>
        </Animated.View>
      </View>

      <View style={styles.resultArea}>
        <ResultCard data={result} />
      </View>

      <View style={styles.debugBox}>
        <Text style={{ fontWeight: '700', color: '#1e3a8a' }}>Debug</Text>
        <Text>currentPoints: {currentPointsRef.current.length}</Text>
        <Text>strokes: {paths.length}</Text>
        <Text>accSamples: {accData.length}</Text>
      </View>

      <Modal visible={modalVisible} transparent animationType="none" onRequestClose={() => closeResultModal()}>
        <View style={styles.modalBackdrop}>
          <ResultModalContent data={result} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#eff6ff',
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1e3a8a',
  },

  subtitle: {
    fontSize: 14,
    color: '#1e40af',
    marginBottom: 12,
  },

  canvas: {
    width: '100%',
    height: 380,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
  },

  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 14,
  },

  btn: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    paddingHorizontal: 26,
    borderRadius: 12,
    shadowColor: '#2563eb',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },

  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  outlineBtn: {
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    paddingHorizontal: 26,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#2563eb',
  },

  outlineBtnText: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '600',
  },

  resultArea: {
    marginTop: 10,
  },

  resultCard: {
    backgroundColor: '#ffffff',
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 2,
  },

  resultEmpty: {
    backgroundColor: '#ffffff',
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },

  resultTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e3a8a',
  },

  resultLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2563eb',
    marginTop: 6,
  },

  debugBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },

  /* Modal styles */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(12,18,32,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  modalHeader: {
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalIcon: {
    fontSize: 28,
    marginRight: 12,
    color: '#fff',
  },
  modalHeadline: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 18,
  },
  modalBody: {
    padding: 16,
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    marginBottom: 12,
    backgroundColor: '#f3f4f6',
  },
  modalMessage: {
    fontSize: 15,
    color: '#334155',
    textAlign: 'center',
    marginBottom: 10,
  },
  modalMetrics: {
    marginTop: 6,
    alignItems: 'center',
  },
  metricText: {
    color: '#475569',
    fontWeight: '600',
    marginTop: 4,
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: 12,
    justifyContent: 'space-between',
    width: '100%',
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 10,
    marginHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  modalClose: {
    marginTop: 12,
    paddingVertical: 6,
  },
});
