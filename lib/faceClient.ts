// Face recognition in the browser (face-api, models in public/face-models). Nothing leaves the device except
// the fingerprints you choose to save; matching against known faces happens right here.

type FaceApi = typeof import("@vladmandic/face-api");
export type SeenFace = { box: { x: number; y: number; w: number; h: number }; name: string | null; score: number; descriptor: Float32Array };

const MATCH = 0.5; // max distance to count as the same person (stricter than face-api's 0.6 default)

let api: FaceApi | null = null;
let loading: Promise<FaceApi> | null = null;
let known: { name: string; descriptors: Float32Array[] }[] = [];

function pin() {
  try {
    return localStorage.getItem("jarvis-pin") || "";
  } catch {
    return "";
  }
}

/** Load the models once (about 6 MB, cached by the browser after the first time). */
export function loadFaces(): Promise<FaceApi> {
  loading ||= (async () => {
    const faceapi = await import("@vladmandic/face-api");
    // face-api's bundled TensorFlow.js; its type file leaves these out.
    const tf = faceapi.tf as unknown as { setBackend(b: string): Promise<boolean>; ready(): Promise<void> };
    await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
    await tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/face-models"),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri("/face-models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/face-models"),
    ]);
    api = faceapi;
    await refreshKnown();
    return faceapi;
  })();
  return loading;
}

/** Fetch known faces from the PC (owner only; guests get none, so nobody is recognized for them). */
export async function refreshKnown() {
  try {
    const r = await fetch("/api/faces", { headers: { "x-jarvis-pin": pin() } });
    if (!r.ok) return void (known = []);
    const d = (await r.json()) as { faces: { name: string; descriptors: number[][] }[] };
    known = d.faces.map((f) => ({ name: f.name, descriptors: f.descriptors.map((x) => new Float32Array(x)) }));
  } catch {
    known = [];
  }
}

const distance = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
};

/** Who is this? Closest known person within MATCH, else null. score = 0..1 confidence. */
function identify(d: Float32Array): { name: string | null; score: number } {
  let best: { name: string; dist: number } | null = null;
  for (const k of known) for (const s of k.descriptors) {
    const dist = distance(d, s);
    if (!best || dist < best.dist) best = { name: k.name, dist };
  }
  return best && best.dist < MATCH ? { name: best.name, score: Math.max(0, Math.min(1, 1 - best.dist / 0.8)) } : { name: null, score: 0 };
}

/** Detect and recognize faces in a video frame. Boxes are in video pixels. */
export async function detectFaces(video: HTMLVideoElement): Promise<SeenFace[]> {
  if (!api || video.readyState < 2) return [];
  const res = await api
    .detectAllFaces(video, new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks(true)
    .withFaceDescriptors();
  return res.map((r) => {
    const b = r.detection.box;
    return { box: { x: b.x, y: b.y, w: b.width, h: b.height }, descriptor: r.descriptor, ...identify(r.descriptor) };
  });
}

/** Save samples of a face under a name. */
export async function saveFace(name: string, samples: Float32Array[]): Promise<string> {
  const r = await fetch("/api/faces", {
    method: "POST",
    headers: { "content-type": "application/json", "x-jarvis-pin": pin() },
    body: JSON.stringify({ name, descriptors: samples.map((s) => Array.from(s)) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (r.status === 401 ? "Only the owner can teach faces." : "Couldn't save the face."));
  await refreshKnown();
  return d.name;
}
