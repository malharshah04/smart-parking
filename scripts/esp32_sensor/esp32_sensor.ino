/**
 * Smart Parking – ESP32 Firmware
 * Uses direct HTTP REST to Firebase — no auth library needed
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>

// ── Pin config ────────────────────────────────────────────────────────────────
#define TRIG_PIN  4
#define ECHO_PIN  18
#define LED_PIN   19

// ── WiFi ──────────────────────────────────────────────────────────────────────
#define WIFI_SSID     "MALHAR"
#define WIFI_PASSWORD "hello123"

// ── Firebase REST base ────────────────────────────────────────────────────────
#define FIREBASE_HOST "https://smartpark-3ce1d-default-rtdb.asia-southeast1.firebasedatabase.app"
#define SLOT_PATH     "/parking/p022/A1"

// ── Detection threshold ───────────────────────────────────────────────────────
#define OCCUPIED_THRESHOLD_CM 15.0

// ── Globals ───────────────────────────────────────────────────────────────────
bool lastOccupied      = false;
unsigned long lastSent = 0;

// ── Firebase write via HTTP PUT ───────────────────────────────────────────────
bool firebasePut(String path, String jsonValue) {
  HTTPClient http;
  String url = String(FIREBASE_HOST) + path + ".json";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.PUT(jsonValue);
  bool ok = (code == 200);
  if (!ok) Serial.printf("   HTTP %d: %s\n", code, http.getString().c_str());
  http.end();
  return ok;
}

// ── Distance measurement (averaged over 10 readings) ─────────────────────────
float getDistance() {
  float sum = 0;
  int valid = 0;
  for (int i = 0; i < 10; i++) {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    noInterrupts();
    long dur = pulseIn(ECHO_PIN, HIGH, 25000);
    interrupts();

    if (dur == 0) { delay(30); continue; }
    float d = (dur * 0.034) / 2.0;
    if (d >= 2 && d <= 400) { sum += d; valid++; }
    delay(30);
  }
  return valid > 0 ? sum / valid : -1;
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN,  OUTPUT);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }
  Serial.println("\n✅ WiFi: " + WiFi.localIP().toString());
  Serial.println("📡 Writing to: " + String(SLOT_PATH));
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
  float dist = getDistance();

  if (dist < 0) {
    Serial.println("⚠️  Sensor error — check wiring");
    digitalWrite(LED_PIN, LOW);
    delay(3000);
    return;
  }

  bool occupied     = dist < OCCUPIED_THRESHOLD_CM;
  String status     = occupied ? "OCCUPIED" : "FREE";
  bool stateChanged = (occupied != lastOccupied);
  bool heartbeat    = (millis() - lastSent > 30000);

  Serial.printf("📏 %.1f cm → %s\n", dist, status.c_str());
  digitalWrite(LED_PIN, occupied ? HIGH : LOW);

  if (WiFi.status() == WL_CONNECTED && (stateChanged || heartbeat)) {
    Serial.println("📤 Sending to Firebase...");

    // Write status and distance as a single JSON object
    String json = "{\"status\":\"" + status + "\",\"distance\":\"" + String(dist, 1) + " cm\"}";
    bool ok = firebasePut(String(SLOT_PATH), json);

    if (ok) {
      Serial.printf("✅ Firebase updated → %s (%.1f cm)\n", status.c_str(), dist);
    } else {
      Serial.println("❌ Firebase write failed — check rules");
    }

    lastOccupied = occupied;
    lastSent     = millis();
  }

  delay(3000);
}