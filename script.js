
import {
  FilesetResolver,
  GestureRecognizer
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs";

// JX HOLOGRAM CAM
const $ = (id) => document.getElementById(id);

const video = $("camera");
const stage = $("cameraStage");
const placeholder = $("placeholder");
const palmHologram = $("palmHologram");
const fistHologram = $("fistHologram");
const handMarker = $("handMarker");

let recognizer = null;
let stream = null;
let running = false;
let animationFrame = null;
let lastVideoTime = -1;
let palmImageURL = "";
let fistImageURL = "";
let lastGesture = "";

function setMessage(message) {
  $("message").textContent = message;
}

function setSystemState(state, active = false) {
  $("systemState").textContent = state;
  document.querySelector(".live-badge i")
    .classList.toggle("active", active);
}

function hideHolograms() {
  palmHologram.classList.add("hidden");
  fistHologram.classList.add("hidden");
  handMarker.classList.add("hidden");
}

function resetGesture() {
  lastGesture = "";
  $("gestureLabel").textContent = "NO GESTURE";
  $("currentGesture").textContent = "None";
  $("hologramStatus").textContent = "Standby";
  hideHolograms();
}

function loadImage(inputId, image, type) {
  const input = $(inputId);

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMessage("Please select a valid image file.");
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      setMessage("Image too large. Please use an image under 12 MB.");
      input.value = "";
      return;
    }

    const url = URL.createObjectURL(file);

    image.onload = () => {
      if (type === "palm") {
        if (palmImageURL) URL.revokeObjectURL(palmImageURL);
        palmImageURL = url;
        $("palmFileStatus").textContent = file.name;
      } else {
        if (fistImageURL) URL.revokeObjectURL(fistImageURL);
        fistImageURL = url;
        $("fistFileStatus").textContent = file.name;
      }

      image.classList.add("hidden");
      setMessage(file.name + " loaded successfully.");
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      setMessage("Unable to load that image. Try another file.");
    };

    image.src = url;
  });
}

loadImage("palmUpload", palmHologram, "palm");
loadImage("fistUpload", fistHologram, "fist");

async function setupRecognizer() {
  if (recognizer) return;

  setMessage("Loading hand tracking engine...");

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
  );

  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  });
}

async function startCamera() {
  if (running) return;

  $("startBtn").disabled = true;
  setSystemState("INITIALIZING");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera unavailable. Open this site using HTTPS.");
    }

    await setupRecognizer();

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    video.srcObject = stream;
    await video.play();

    running = true;
    lastVideoTime = -1;
    stage.classList.add("camera-on");
    placeholder.classList.add("hidden");

    $("stopBtn").disabled = false;
    $("cameraStatus").textContent = "CAMERA LIVE";
    $("trackingStatus").textContent = "Searching...";
    setSystemState("ONLINE", true);
    setMessage("Camera active. Show an open palm or a fist.");
    animationFrame = requestAnimationFrame(detectFrame);

  } catch (error) {
    stopCamera();
    console.error(error);

    let message = error.message || "Unable to start camera.";

    if (error.name === "NotAllowedError") {
      message = "Camera permission denied. Allow camera access in browser settings.";
    } else if (error.name === "NotFoundError") {
      message = "No camera was found on this device.";
    } else if (error.name === "NotReadableError") {
      message = "Camera is busy. Close other apps using the camera.";
    }

    setMessage(message);
    setSystemState("ERROR");
    $("startBtn").disabled = false;
  }
}

function detectFrame() {
  if (!running) return;

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    try {
      const result = recognizer.recognizeForVideo(
        video,
        performance.now()
      );

      handleResult(result);
    } catch (error) {
      console.error("Detection error:", error);
    }
  }

  if (running) {
    animationFrame = requestAnimationFrame(detectFrame);
  }
}

function handleResult(result) {
  const landmarks = result.landmarks?.[0];

  if (!landmarks?.length) {
    $("trackingStatus").textContent = "Searching...";
    resetGesture();
    return;
  }

  $("trackingStatus").textContent = "Hand detected";

  // Find the approximate hand center and size.
  const xs = landmarks.map(point => point.x);
  const ys = landmarks.map(point => point.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // The camera is mirrored, so reverse horizontal position.
  const centerX = 1 - (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const width = stage.clientWidth;
  const height = stage.clientHeight;

  const left = Math.max(8, Math.min(92, centerX * 100));
  const top = Math.max(10, Math.min(90, centerY * 100));

  handMarker.style.left = left + "%";
  handMarker.style.top = top + "%";
  handMarker.classList.remove("hidden");

  // Size the effect relative to the detected hand.
  const effectSize = Math.max(
    85,
    Math.min(240, (maxX - minX) * width * 1.8)
  );

  const categories = result.gestures?.[0] || [];
  const best = categories[0];

  const gesture = best && best.score >= 0.55
    ? best.categoryName
    : "Unknown";

  if (gesture === "Open_Palm") {
    showHologram("palm", left, top, effectSize);
  } else if (gesture === "Closed_Fist") {
    showHologram("fist", left, top, effectSize);
  } else {
    resetGesture();
  }
}

function showHologram(type, left, top, size) {
  const image = type === "palm" ? palmHologram : fistHologram;
  const other = type === "palm" ? fistHologram : palmHologram;
  const loaded = type === "palm" ? palmImageURL : fistImageURL;

  other.classList.add("hidden");

  $("gestureLabel").textContent =
    type === "palm" ? "OPEN PALM DETECTED" : "CLOSED FIST DETECTED";

  $("currentGesture").textContent =
    type === "palm" ? "Open Palm" : "Closed Fist";

  $("hologramStatus").textContent =
    loaded ? (type === "palm" ? "Hologram 01" : "Hologram 02")
           : "Waiting for your image";

  if (loaded) {
    image.style.left = left + "%";
    image.style.top = top + "%";
    image.style.width = size + "px";
    image.style.height = size + "px";
    image.classList.remove("hidden");
  } else {
    image.classList.add("hidden");
  }

  lastGesture = type;
}

function stopCamera() {
  running = false;

  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  video.pause();
  video.srcObject = null;
  stage.classList.remove("camera-on");
  placeholder.classList.remove("hidden");

  $("startBtn").disabled = false;
  $("stopBtn").disabled = true;
  $("cameraStatus").textContent = "CAMERA OFF";
  $("trackingStatus").textContent = "Inactive";

  resetGesture();
  setSystemState("STANDBY");
}

$("startBtn").addEventListener("click", startCamera);
$("stopBtn").addEventListener("click", () => {
  stopCamera();
  setMessage("Camera stopped.");
});

window.addEventListener("pagehide", () => {
  stopCamera();

  if (recognizer) {
    recognizer.close();
    recognizer = null;
  }
});
