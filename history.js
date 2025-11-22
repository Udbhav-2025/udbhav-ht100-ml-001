// app/history.js
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';

// Change this to how you retrieve token in your app
import * as SecureStore from 'expo-secure-store';
// If you already have API_URL in a config file, import it here.
// If not, define it directly:
const API_URL = 'https://<your-ngrok>.ngrok.io/infer';

// Base API without /infer:


const API_BASE = API_URL.replace('/infer',''); // reuse same base

export default function HistoryScreen() {
  const [loading, setLoading] = useState(true);
  const [tests, setTests] = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const token = await SecureStore.getItemAsync('userToken');
      if (!token) {
        Alert.alert('Not logged in', 'Please sign in to view history');
        setLoading(false);
        return;
      }
      const resp = await fetch(`${API_BASE}/tests`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error('fetch tests failed ' + resp.status);
      const json = await resp.json();
      setTests(json.tests || []);
    } catch (err) {
      console.warn('load history failed', err);
      Alert.alert('Failed', String(err));
    } finally {
      setLoading(false);
    }
  }

  function renderItem({ item }) {
    return (
      <View style={styles.card}>
        <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ fontWeight: '700' }}>{item.result?.decision ?? 'No label'}</Text>
          <Text style={{ color: '#444' }}>{item.result?.score ? `Score: ${Number(item.result.score).toFixed(3)}` : ''}</Text>
          <Text style={{ color: '#666', fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()}</Text>
        </View>
      </View>
    );
  }

  if (loading) return <View style={{flex:1,justifyContent:'center',alignItems:'center'}}><ActivityIndicator /></View>;

  if (!tests.length) return <View style={{padding:20}}><Text>No history yet</Text></View>;

  return (
    <FlatList
      data={tests}
      keyExtractor={t => t._id}
      renderItem={renderItem}
      contentContainerStyle={{ padding: 12 }}
    />
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor:'#fff', marginBottom:10, borderRadius:10, elevation:2 },
  thumb: { width: 90, height: 90, borderRadius:8, backgroundColor:'#f2f2f2' }
});
