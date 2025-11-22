
// HomeScreen.js
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  Alert,
} from "react-native";
import { Link } from "expo-router";
import * as SecureStore from 'expo-secure-store';
import Write from "./write";   // <-- import your write.js screen

function WriteScreenWrapper({ onCancel }) {
  return <Write onCancel={onCancel} />;
}

/* ======================================================
   MAIN SCREEN
====================================================== */

export default function HomeScreen() {
  const [route, setRoute] = useState("welcome");
  const [user, setUser] = useState(null);

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ padding: 20 }}>
      <Header user={user} setRoute={setRoute} setUser={setUser} />

      <View style={{ marginTop: 20, width: "100%", maxWidth: 900, alignSelf: "center" }}>

        {route === "welcome" && (
          <Welcome
            onStart={() => setRoute("signup")}
            onLogin={() => setRoute("login")}
          />
        )}

        {route === "login" && (
          <Auth
            mode="login"
            onBack={() => setRoute("welcome")}
            onSuccess={(u) => {
              setUser(u);
              setRoute("home");
            }}
          />
        )}

        {route === "signup" && (
          <Auth
            mode="signup"
            onBack={() => setRoute("welcome")}
            onSuccess={(u) => {
              setUser(u);
              setRoute("home");
            }}
          />
        )}

        {route === "home" && (
          <Home
            user={user}
            onDraw={() => setRoute("draw")}
          />
        )}

        {route === "draw" && (
          <DrawScreen onCancel={() => setRoute("home")} />
        )}

        {route === "write" && (
  <WriteScreenWrapper onCancel={() => setRoute("home")} />
  )}


      </View>
    </ScrollView>
  );
}

/* ======================================================
   HEADER
====================================================== */

function Header({ user, setRoute, setUser }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Tremor Tracker</Text>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <TouchableOpacity style={styles.navBtn} onPress={() => setRoute("home")}>
          <Text style={styles.navBtnText}>Home</Text>
        </TouchableOpacity>

        {user ? (
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => {
              setUser(null);
              setRoute("welcome");
            }}
          >
            <Text style={styles.navBtnText}>Logout</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => setRoute("login")}
          >
            <Text style={styles.navBtnText}>Login</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/* ======================================================
   WELCOME SCREEN
====================================================== */

function Welcome({ onStart, onLogin }) {
  return (
    <View style={styles.cardLarge}>
      <Text style={styles.heroTitle}>Early Parkinson's Screening</Text>

      <Text style={styles.heroText}>
        Draw a guided spiral — AI analyzes tremor patterns to detect early signs
        of Parkinson’s disease.
      </Text>

      <View style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}>
        <TouchableOpacity style={styles.primaryBtn} onPress={onStart}>
          <Text style={styles.primaryBtnText}>Sign Up</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.outlineBtn} onPress={onLogin}>
          <Text style={styles.outlineBtnText}>Login</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subtle}>
        Powered by AI · Not a medical diagnosis
      </Text>
    </View>
  );
}

/* ======================================================
   LOGIN / SIGNUP
====================================================== */

function Auth({ mode, onBack, onSuccess }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");

  const isSignup = mode === "signup";

  function handleSubmit() {
    if (isSignup) {
      if (!username.trim() || !email.trim() || !pass.trim()) {
        Alert.alert("Validation", "All fields are required.");
        return;
      }
    } else {
      if (!username.trim() || !pass.trim()) {
        Alert.alert("Validation", "Username and password required.");
        return;
      }
    }

    onSuccess({ name: username || "User" });
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>
        {isSignup ? "Create Account" : "Login"}
      </Text>

      <Text style={styles.label}>Username</Text>
      <TextInput value={username} onChangeText={setUsername} style={styles.input} />

      {isSignup && (
        <>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            keyboardType="email-address"
          />
        </>
      )}

      <Text style={styles.label}>Password</Text>
      <TextInput
        secureTextEntry
        value={pass}
        onChangeText={setPass}
        style={styles.input}
      />

      <View style={{ flexDirection: "row", gap: 12, marginTop: 18 }}>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit}>
          <Text style={styles.primaryBtnText}>
            {isSignup ? "Sign Up" : "Login"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.outlineBtn} onPress={onBack}>
          <Text style={styles.outlineBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ======================================================
   HOME SCREEN
====================================================== */

function Home({ user, onDraw }) {
  return (
    <View style={styles.card}>
      <Text style={styles.welcomeTitle}>Hello, {user?.name}</Text>

      <Text style={styles.paragraph}>
        Draw a spiral using your finger or stylus. The system will analyze
        tremor patterns to estimate stability.
      </Text>

      <Text style={styles.hint}>Smooth drawing = lower tremor score</Text>

      <TouchableOpacity
        style={[styles.primaryBtn, { marginTop: 20 }]}
        onPress={onDraw}
      >
        <TouchableOpacity
        style={[styles.primaryBtn, { marginTop: 12 }]}
        onPress={() => onWrite()}
        />
        <Text style={styles.primaryBtnText}>Start Tremor Test</Text>
      </TouchableOpacity>

        
        
      <FooterSection />
    </View>
  );
}

/* ======================================================
   UPDATED DRAW SCREEN → BUTTON ONLY
====================================================== */

function DrawScreen({ onCancel }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Draw the Spiral</Text>

      <Text style={{ marginBottom: 20, color: "#1e3a8a" }}>
        Tap below to open the full drawing screen.
      </Text>

      <Link href="./draw" asChild>
        <TouchableOpacity style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Go to Drawing Screen</Text>
        </TouchableOpacity>
      </Link>

      <TouchableOpacity
        style={[styles.outlineBtn, { marginTop: 16 }]}
        onPress={onCancel}
      >
        <Text style={styles.outlineBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ======================================================
   FOOTER SECTION
====================================================== */

function FooterSection() {
  return (
    <View style={{ marginTop: 30 }}>
      <View style={[styles.card, { padding: 16 }]}>
        <Text style={styles.sectionTitle}>Feedback</Text>

        <TextInput
          multiline
          placeholder="Write your feedback here..."
          style={styles.feedbackInput}
        />

        <TouchableOpacity style={[styles.primaryBtn, { marginTop: 10 }]}>
          <Text style={styles.primaryBtnText}>Submit Feedback</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { padding: 16, marginTop: 12 }]}>
        <Text style={styles.sectionTitle}>Contact Us</Text>
        <Text style={styles.contactText}>
          <Text style={{ fontWeight: "700" }}>Email: </Text>
          support@tremortracker.com
        </Text>
        <Text style={styles.contactText}>
          <Text style={{ fontWeight: "700" }}>Phone: </Text>
          +91 9xxxxxxxx1
        </Text>
        <Text style={styles.contactText}>
          <Text style={{ fontWeight: "700" }}>Office: </Text>
          KMIT
        </Text>
      </View>

      <View style={{ alignItems: "center", marginTop: 12 }}>
        <View
          style={{ height: 1, backgroundColor: "#dbeafe", width: "100%", marginBottom: 10 }}
        />
        <Text style={{ color: "#1e3a8a", fontSize: 14 }}>
          © {new Date().getFullYear()} Tremor Tracker
        </Text>
      </View>
    </View>
  );
}

/* ======================================================
   STYLES
====================================================== */

const styles = StyleSheet.create({
  page: { backgroundColor: "#eff6ff", flex: 1 },

  header: {
    backgroundColor: "white",
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#dbeafe",
    flexDirection: "row",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
  },

  headerTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: "#1e3a8a",
  },

  navBtn: { padding: 8 },

  navBtnText: { color: "#2563eb", fontWeight: "600" },

  cardLarge: {
    backgroundColor: "white",
    padding: 30,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#dbeafe",
    alignItems: "center",
  },

  card: {
    backgroundColor: "white",
    padding: 22,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbeafe",
    marginBottom: 18,
  },

  heroTitle: {
    fontSize: 30,
    fontWeight: "700",
    color: "#1e3a8a",
  },

  heroText: {
    marginTop: 10,
    fontSize: 16,
    textAlign: "center",
    color: "#1e3a8a",
    marginBottom: 20,
  },

  subtle: { marginTop: 12, color: "#64748b", fontSize: 13 },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1e3a8a",
    marginBottom: 10,
  },

  label: {
    marginTop: 10,
    marginBottom: 6,
    fontWeight: "600",
    color: "#1e3a8a",
  },

  input: {
    borderWidth: 2,
    borderColor: "#bfdbfe",
    padding: 10,
    borderRadius: 10,
    backgroundColor: "white",
  },

  primaryBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
  },

  primaryBtnText: { color: "white", fontWeight: "700", fontSize: 16 },

  outlineBtn: {
    borderWidth: 2,
    borderColor: "#2563eb",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
  },

  outlineBtnText: { color: "#2563eb", fontWeight: "700" },

  welcomeTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1e3a8a",
  },

  paragraph: { marginTop: 10, fontSize: 15, color: "#1e3a8a", lineHeight: 22 },

  hint: {
    marginTop: 10,
    color: "#2563eb",
    fontWeight: "600",
  },

  feedbackInput: {
    height: 100,
    borderWidth: 2,
    borderColor: "#bfdbfe",
    borderRadius: 12,
    padding: 10,
    textAlignVertical: "top",
  },

  contactText: { color: "#1e3a8a", marginTop: 8 },
});