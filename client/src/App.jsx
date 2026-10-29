
import { useEffect, useRef, useState } from 'react';
import Whiteboard from './Whiteboard';
import { io } from 'socket.io-client';
import './App.css';
import FileSharing from './FileSharing';

const SERVER_URL = 'http://localhost:3000';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

function App() {
  const socketRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const screenVideoRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const meetingRef = useRef('');
  const screenSendersRef = useRef(new Map());

  const [meetingId, setMeetingId] = useState('');
  const [activeMeeting, setActiveMeeting] = useState('');
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenError, setScreenError] = useState('');
  const [error, setError] = useState('');

  function closePeer(peerId) {
    const pc = peersRef.current.get(peerId);

    if (pc) {
      pc.close();
      peersRef.current.delete(peerId);
    }

    screenSendersRef.current.delete(peerId);

    setRemoteStreams((current) =>
      current.filter((item) => item.id !== peerId)
    );
  }

  function closeAllPeers() {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    screenSendersRef.current.clear();
    setRemoteStreams([]);
  }

  function createPeerConnection(peerId) {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });

    peersRef.current.set(peerId, pc);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, streamRef.current);
      });
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && meetingRef.current) {
        socketRef.current?.emit('webrtc-ice-candidate', {
          meetingId: meetingRef.current,
          targetId: peerId,
          data: candidate,
        });
      }
    };

    pc.ontrack = ({ streams }) => {
      const stream = streams[0];
      if (!stream) return;

      setRemoteStreams((current) => {
        const existingStream = current.find(
          (item) => item.id === peerId
        );

        if (existingStream) {
          return current.map((item) =>
            item.id === peerId
              ? { id: peerId, stream }
              : item
          );
        }

        return [...current, { id: peerId, stream }];
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        console.error('WebRTC connection failed:', peerId);
      }
    };

    return pc;
  }

  async function makeOffer(peerId) {
    try {
      const pc = createPeerConnection(peerId);
      if (pc.signalingState !== 'stable') return;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current?.emit('webrtc-offer', {
        meetingId: meetingRef.current,
        targetId: peerId,
        data: pc.localDescription,
      });
    } catch (err) {
      console.error('Offer error:', err);
      setError('Could not establish a video connection.');
    }
  }

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('participant-joined', (participant) => {
      setParticipants((current) =>
        current.some((item) => item.id === participant.id)
          ? current
          : [...current, participant]
      );
    });

    socket.on('participant-left', ({ id }) => {
      closePeer(id);
      setParticipants((current) =>
        current.filter((participant) => participant.id !== id)
      );
    });

    socket.on('webrtc-offer', async ({ meetingId, from, data }) => {
      if (meetingId !== meetingRef.current || !streamRef.current) return;

      try {
        const pc = createPeerConnection(from);
        await pc.setRemoteDescription(data);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('webrtc-answer', {
          meetingId,
          targetId: from,
          data: pc.localDescription,
        });
      } catch (err) {
        console.error('Offer handling error:', err);
      }
    });

    socket.on('webrtc-answer', async ({ meetingId, from, data }) => {
      if (meetingId !== meetingRef.current) return;

      const pc = peersRef.current.get(from);
      if (!pc || pc.signalingState !== 'have-local-offer') return;

      try {
        await pc.setRemoteDescription(data);
      } catch (err) {
        console.error('Answer handling error:', err);
      }
    });

    socket.on(
      'webrtc-ice-candidate',
      async ({ meetingId, from, data }) => {
        if (meetingId !== meetingRef.current) return;

        const pc = peersRef.current.get(from);
        if (!pc || !pc.remoteDescription) return;

        try {
          await pc.addIceCandidate(data);
        } catch (err) {
          console.error('ICE candidate error:', err);
        }
      }
    );

    return () => {
      socket.disconnect();
      closeAllPeers();

      streamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());

      streamRef.current = null;
      screenStreamRef.current = null;
      socketRef.current = null;
      meetingRef.current = '';
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = cameraOn
        ? streamRef.current
        : null;
    }
  }, [cameraOn, activeMeeting]);

  useEffect(() => {
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = screenSharing
        ? screenStreamRef.current
        : null;
    }
  }, [screenSharing]);

  useEffect(() => {
    remoteStreams.forEach(({ id, stream }) => {
      const video = document.getElementById(`remote-${id}`);

      if (video && video.srcObject !== stream) {
        video.srcObject = stream;
        video.play().catch(() => {});
      }
    });
  }, [remoteStreams]);

  async function startCamera() {
    setCameraError('');
    setCameraLoading(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      streamRef.current = stream;
      setCameraOn(true);

      peersRef.current.forEach((pc) => {
        stream.getTracks().forEach((track) => {
          const alreadyAdded = pc.getSenders().some(
            (sender) => sender.track === track
          );

          if (!alreadyAdded) pc.addTrack(track, stream);
        });
      });

      participants.forEach((participant) => {
        if (participant.id !== socketRef.current?.id) {
          makeOffer(participant.id);
        }
      });
    } catch (err) {
      setCameraError(
        `${err.name || 'Error'}: ${err.message || 'Could not start camera.'}`
      );
    } finally {
      setCameraLoading(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
    closeAllPeers();
  }

  async function startScreenSharing() {
    setScreenError('');

    if (!cameraOn || !streamRef.current) {
      setScreenError('Start your camera before sharing your screen.');
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenError('Screen sharing is not supported in this browser.');
      return;
    }

    let screenStream;

    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const screenTrack = screenStream.getVideoTracks()[0];

      if (!screenTrack) {
        throw new Error('No screen video track was selected.');
      }

      const replacements = [];

      for (const [peerId, pc] of peersRef.current.entries()) {
        const sender = pc.getSenders().find(
          (item) => item.track?.kind === 'video'
        );

        if (!sender) continue;

        const cameraTrack = sender.track;

        await sender.replaceTrack(screenTrack);

        screenSendersRef.current.set(peerId, {
          sender,
          cameraTrack,
        });

        replacements.push(peerId);
      }

      if (replacements.length === 0) {
        throw new Error(
          'No active video connections found. Connect to another participant first.'
        );
      }

      screenStreamRef.current = screenStream;
      setScreenSharing(true);

      screenTrack.addEventListener(
        'ended',
        () => stopScreenSharing(),
        { once: true }
      );
    } catch (err) {
      for (const saved of screenSendersRef.current.values()) {
        try {
          await saved.sender.replaceTrack(saved.cameraTrack);
        } catch (restoreError) {
          console.error('Could not restore camera:', restoreError);
        }
      }

      screenSendersRef.current.clear();
      screenStream?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setScreenSharing(false);

      setScreenError(
        `${err.name || 'Error'}: ${err.message || 'Could not start screen sharing.'}`
      );
    }
  }

  async function stopScreenSharing() {
    const screenStream = screenStreamRef.current;
    screenStreamRef.current = null;

    screenStream?.getTracks().forEach((track) => track.stop());

    for (const [peerId, saved] of screenSendersRef.current.entries()) {
      const pc = peersRef.current.get(peerId);

      try {
        if (
          pc &&
          pc.connectionState !== 'closed' &&
          saved.cameraTrack?.readyState === 'live'
        ) {
          await saved.sender.replaceTrack(saved.cameraTrack);
        }
      } catch (err) {
        console.error('Could not restore camera track:', err);
      }

      screenSendersRef.current.delete(peerId);
    }

    setScreenSharing(false);
    setScreenError('');
  }

  function createMeeting() {
    if (!socketRef.current?.connected) {
      setError('Cannot connect to the server.');
      return;
    }

    setLoading(true);
    setError('');

    socketRef.current.emit('create-meeting', (response) => {
      setLoading(false);

      if (!response?.ok) {
        setError(response?.error || 'Could not create meeting.');
        return;
      }

      meetingRef.current = response.meetingId;
      setMeetingId(response.meetingId);
      setActiveMeeting(response.meetingId);
      setParticipants(response.participants || []);
    });
  }

  function joinMeeting() {
    const id = meetingId.trim().toLowerCase();

    if (!id) {
      setError('Enter a meeting ID.');
      return;
    }

    if (!socketRef.current?.connected) {
      setError('Cannot connect to the server.');
      return;
    }

    setLoading(true);
    setError('');

    socketRef.current.emit('join-meeting', { meetingId: id }, (response) => {
      setLoading(false);

      if (!response?.ok) {
        setError(response?.error || 'Could not join meeting.');
        return;
      }

      meetingRef.current = response.meetingId;
      setMeetingId(response.meetingId);
      setActiveMeeting(response.meetingId);
      setParticipants(response.participants || []);
    });
  }

  function leaveMeeting() {
    stopCamera();
    stopScreenSharing();

    if (meetingRef.current) {
      socketRef.current?.emit('leave-meeting', {
        meetingId: meetingRef.current,
      });
    }

    meetingRef.current = '';
    setActiveMeeting('');
    setMeetingId('');
    setParticipants([]);
    setError('');
  }

  async function copyMeetingId() {
    try {
      await navigator.clipboard.writeText(activeMeeting);
      setError('');
    } catch {
      setError('Copy failed. Please copy the meeting ID manually.');
    }
  }

  return (
    <div className="app">
      <header className="navbar">
        <h2>B2C-Fun<span>.</span></h2>

        <div className="connection-status">
          <span className={connected ? 'dot' : 'dot offline'} />
          {connected ? 'Server connected' : 'Connecting to server...'}
        </div>
      </header>

      {!activeMeeting ? (
        <main className="hero">
          <div className="hero-content">
            <span className="tag">YOUR SPACE TO CONNECT</span>
            <h1>
              Meet. Share.
              <br />
              <span>Collaborate.</span>
            </h1>
            <p>Simple video meetings and collaboration.</p>

            <div className="actions">
              <button
                onClick={createMeeting}
                disabled={loading || !connected}
              >
                {loading ? 'Please wait...' : 'Create Meeting'}
              </button>
            </div>

            <div className="join-form">
              <label htmlFor="meeting-id">Have a meeting ID?</label>
              <div className="join-input-row">
                <input
                  id="meeting-id"
                  value={meetingId}
                  onChange={(event) => setMeetingId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') joinMeeting();
                  }}
                  placeholder="Enter meeting ID"
                />
                <button
                  className="secondary"
                  onClick={joinMeeting}
                  disabled={loading || !connected}
                >
                  Join
                </button>
              </div>
            </div>

            {error && <p className="error-message">{error}</p>}
          </div>
        </main>
      ) : (
        <main className="hero meeting-page">
          <div className="hero-content">
            <span className="tag">MEETING ROOM</span>
            <h1>You're in the <span>room!</span></h1>
            <p>Meeting ID: <strong>{activeMeeting}</strong></p>

            <div className="actions">
              <button onClick={copyMeetingId}>Copy Meeting ID</button>
              <button className="secondary" onClick={leaveMeeting}>
                Leave Meeting
              </button>
            </div>

            <section className="participants">
              <h2>Participants ({participants.length})</h2>
              <ul>
                {participants.map((participant) => (
                  <li key={participant.id}>
                    {participant.name}
                    {participant.id === socketRef.current?.id && ' (You)'}
                  </li>
                ))}
              </ul>
            </section>

            <section className="camera-section">
              <h2>Your camera</h2>

              {cameraOn ? (
                <video
                  ref={videoRef}
                  className="camera-video"
                  autoPlay
                  playsInline
                  muted
                />
              ) : (
                <p>Your camera is off.</p>
              )}

              <div className="actions">
                {!cameraOn ? (
                  <button onClick={startCamera} disabled={cameraLoading}>
                    {cameraLoading ? 'Starting...' : 'Start Camera & Mic'}
                  </button>
                ) : (
                  <button className="secondary" onClick={stopCamera}>
                    Stop Camera & Mic
                  </button>
                )}
              </div>

              {cameraError && (
                <p className="error-message">{cameraError}</p>
              )}
            </section>

            <section className="remote-videos">
              <h2>Other participants</h2>
              <div className="remote-video-grid">
                {remoteStreams.map(({ id }) => (
                  <div key={id}>
                    <video
                      id={`remote-${id}`}
                      className="camera-video"
                      autoPlay
                      playsInline
                    />
                    <p>Participant {id.slice(0, 6)}</p>
                  </div>
                ))}
              </div>
              {remoteStreams.length === 0 && <p>No remote video yet.</p>}
            </section>

            <section className="screen-sharing-section">
              <h2>Screen sharing</h2>

              {screenSharing && (
                <video
                  ref={screenVideoRef}
                  className="camera-video"
                  autoPlay
                  playsInline
                  muted
                />
              )}

              <div className="actions">
                {!screenSharing ? (
                  <button onClick={startScreenSharing}>
                    Share Screen
                  </button>
                ) : (
                  <button className="secondary" onClick={stopScreenSharing}>
                    Stop Sharing
                  </button>
                )}
              </div>

              {screenError && (
                <p className="error-message">{screenError}</p>
              )}

              <p className="camera-note">
                Screen sharing uses your existing WebRTC connections.
              </p>
            </section>

            <Whiteboard socket={socketRef.current} meetingId={activeMeeting} />

            <FileSharing
              socket={socketRef.current}
              meetingId={activeMeeting}
            />
          </div>
        </main>
      )}
    </div>
  );
}

export default App;
