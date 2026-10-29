
import { useEffect, useState } from 'react';

const SERVER_URL = 'http://localhost:3000';

export default function FileSharing({ socket, meetingId }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setFiles([]);

    function handleFileShared(file) {
      if (file.meetingId !== meetingId) return;

      setFiles((current) =>
        current.some((item) => item.id === file.id)
          ? current
          : [...current, file]
      );
    }

    socket?.on('file-shared', handleFileShared);

    return () => {
      socket?.off('file-shared', handleFileShared);
    };
  }, [socket, meetingId]);

  async function uploadFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    setError('');

    if (file.size > 5 * 1024 * 1024) {
      setError('Maximum file size is 5 MB.');
      return;
    }

    const allowed = [
      'application/pdf',
      'text/plain',
      'image/png',
      'image/jpeg',
    ];

    if (!allowed.includes(file.type)) {
      setError('Only PDF, TXT, PNG, and JPEG files are allowed.');
      return;
    }

    if (!socket?.connected || !meetingId) {
      setError('Connect to a meeting before sharing files.');
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('socketId', socket.id);
      formData.append('file', file);

      const response = await fetch(
        `${SERVER_URL}/api/meetings/${encodeURIComponent(meetingId)}/files`,
        {
          method: 'POST',
          body: formData,
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed.');
      }

      setFiles((current) =>
        current.some((item) => item.id === result.id)
          ? current
          : [...current, result]
      );
    } catch (err) {
      setError(err.message || 'Could not upload the file.');
    } finally {
      setUploading(false);
    }
  }

  async function downloadFile(file) {
    setError('');

    try {
      const url =
        `${SERVER_URL}/api/meetings/${encodeURIComponent(meetingId)}` +
        `/files/${encodeURIComponent(file.id)}` +
        `?socketId=${encodeURIComponent(socket.id)}`;

      const response = await fetch(url);

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Download failed.');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = objectUrl;
      link.download = file.name;
      link.click();

      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err.message || 'Could not download the file.');
    }
  }

  return (
    <section className="file-sharing-section">
      <h2>Shared files</h2>
      <p>Share PDF, text, PNG, or JPEG files up to 5 MB.</p>

      <input
        type="file"
        accept=".pdf,.txt,.png,.jpg,.jpeg"
        onChange={uploadFile}
        disabled={uploading}
      />

      {uploading && <p>Uploading file...</p>}

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {files.length === 0 ? (
        <p>No files shared yet.</p>
      ) : (
        <ul>
          {files.map((file) => (
            <li key={file.id}>
              {file.name} ({(file.size / 1024).toFixed(1)} KB){' '}
              <button onClick={() => downloadFile(file)}>
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
