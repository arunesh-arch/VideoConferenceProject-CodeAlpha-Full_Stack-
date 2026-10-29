
import { useEffect, useRef, useState } from 'react';
import './Whiteboard.css';

export default function Whiteboard({ socket, meetingId }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const previousPointRef = useRef(null);

  const [color, setColor] = useState('#222222');

  function drawStroke(stroke) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const { from, to, color: strokeColor } = stroke;

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
    ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
    ctx.stroke();
  }

  useEffect(() => {
    if (!socket || !meetingId) return;

    function handleStroke(message) {
      if (message.meetingId !== meetingId) return;
      drawStroke(message.stroke);
    }

    function handleClear(message) {
      if (message.meetingId !== meetingId) return;

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.getContext('2d').clearRect(
          0, 0, canvas.width, canvas.height
        );
      }
    }

    socket.on('whiteboard-stroke', handleStroke);
    socket.on('whiteboard-clear', handleClear);

    return () => {
      socket.off('whiteboard-stroke', handleStroke);
      socket.off('whiteboard-clear', handleClear);
    };
  }, [socket, meetingId]);

  function getPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function startDrawing(event) {
    drawingRef.current = true;
    previousPointRef.current = getPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueDrawing(event) {
    if (!drawingRef.current || !previousPointRef.current) return;

    const nextPoint = getPoint(event);

    const stroke = {
      from: previousPointRef.current,
      to: nextPoint,
      color,
    };

    drawStroke(stroke);

    socket?.emit('whiteboard-stroke', {
      meetingId,
      stroke,
    });

    previousPointRef.current = nextPoint;
  }

  function stopDrawing() {
    drawingRef.current = false;
    previousPointRef.current = null;
  }

  function clearBoard() {
    const canvas = canvasRef.current;

    if (canvas) {
      canvas.getContext('2d').clearRect(
        0, 0, canvas.width, canvas.height
      );
    }

    socket?.emit('whiteboard-clear', { meetingId });
  }

  return (
    <section className="whiteboard-section">
      <h2>Shared whiteboard</h2>

      <div className="whiteboard-toolbar">
        <label>
          Drawing color
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="secondary"
          onClick={clearBoard}
        >
          Clear board
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="whiteboard-canvas"
        width={1000}
        height={500}
        onPointerDown={startDrawing}
        onPointerMove={continueDrawing}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        onLostPointerCapture={stopDrawing}
        aria-label="Shared drawing whiteboard"
      />
    </section>
  );
}
