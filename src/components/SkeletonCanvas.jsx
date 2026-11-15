import { useEffect, useRef } from 'react';

import { SKELETON_EDGES } from '@shared/landmarks.js';

const HIGHLIGHT = '#5eead4';
const BONE = 'rgba(226, 232, 240, 0.55)';

function drawPose(context, points, { width, height, highlightSide = null } = {}) {
  if (!points) return;
  context.clearRect(0, 0, width, height);

  const highlightPrefix = highlightSide ? `${highlightSide}` : null;

  for (const [from, to] of SKELETON_EDGES) {
    const a = points[from];
    const b = points[to];
    if (!a?.visible || !b?.visible) continue;
    const isLeg = from.includes('Knee') || to.includes('Knee') || from.includes('Ankle') || to.includes('Ankle');
    context.strokeStyle = isLeg ? HIGHLIGHT : BONE;
    context.lineWidth = isLeg ? 3 : 2;
    context.beginPath();
    context.moveTo(a.x * width, a.y * height);
    context.lineTo(b.x * width, b.y * height);
    context.stroke();
  }

  for (const [name, point] of Object.entries(points)) {
    if (!point?.visible) continue;
    const isHighlighted = highlightPrefix && name.startsWith(highlightPrefix);
    context.fillStyle = isHighlighted ? HIGHLIGHT : 'rgba(148, 163, 184, 0.85)';
    context.beginPath();
    context.arc(point.x * width, point.y * height, isHighlighted ? 4.5 : 3, 0, Math.PI * 2);
    context.fill();
  }
}

/** Live overlay: draws whatever the tracker last produced, sized to the video. */
export function LiveSkeletonCanvas({ points, videoRef, highlightSide, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef?.current;
    if (!canvas || !video) return;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    drawPose(context, points, { width, height, highlightSide });
  }, [points, videoRef, highlightSide]);

  return <canvas ref={canvasRef} className={`skeleton-canvas ${className}`} />;
}

/** Replay: animates a stored landmark sequence. No video involved. */
export default function SkeletonCanvas({ landmarks, highlightSide, playing = true, width = 480, height = 270 }) {
  const canvasRef = useRef(null);
  const frameIndex = useRef(0);
  const lastTime = useRef(0);

  // Keep the original frame proportions so the figure is not stretched.
  const aspect = Number(landmarks?.aspect);
  const canvasHeight =
    Number.isFinite(aspect) && aspect > 0 ? Math.round(width / aspect) : Math.round(width / (16 / 9)) || height;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');

    const frames = landmarks?.frames || [];
    if (frames.length === 0) {
      context.clearRect(0, 0, width, canvasHeight);
      return undefined;
    }

    frameIndex.current = 0;
    lastTime.current = 0;
    const fps = landmarks?.fps || 30;
    let raf = 0;

    const render = (time) => {
      const frame = frames[frameIndex.current % frames.length];
      drawPose(context, frame, { width, height: canvasHeight, highlightSide });
      if (playing) {
        if (!lastTime.current) lastTime.current = time;
        const elapsed = time - lastTime.current;
        if (elapsed > 1000 / fps) {
          frameIndex.current = (frameIndex.current + 1) % frames.length;
          lastTime.current = time;
        }
      }
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [landmarks, highlightSide, playing, width, canvasHeight]);

  if (!landmarks?.frames?.length) {
    return <p className="muted small">No landmark data was stored for this trial.</p>;
  }

  return (
    <canvas ref={canvasRef} width={width} height={canvasHeight} className="skeleton-canvas replay" />
  );
}
