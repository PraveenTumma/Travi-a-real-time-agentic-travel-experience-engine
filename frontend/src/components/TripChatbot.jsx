import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, MessageCircle, Sparkles } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || window.location.origin;

// Quick-ask chips the user can tap
const QUICK_QUESTIONS = [
  { label: '💰 Total budget?', message: 'What is my total estimated budget for this trip?' },
  { label: '🍜 Best food day?', message: 'Which day has the best food recommendations?' },
  { label: '🧳 Packing tips?', message: 'What should I pack for this trip?' },
  { label: '🏃 Busiest day?', message: 'Which day has the most activities and walking?' },
  { label: '🌧️ Rainy days?', message: 'Are there any rainy days I should prepare for?' },
  { label: '⭐ Must-do?', message: 'What is the single must-do highlight of this trip?' },
];

export default function TripChatbot({ itinerary, destination }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hey there! 👋 I'm **Travi**, your AI travel buddy. I've read your entire ${destination || 'trip'} itinerary — ask me anything about your plan!`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text) => {
    const userMessage = text || input.trim();
    if (!userMessage || loading) return;

    const newMessages = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          itinerary: itinerary,
          destination: destination,
          history: newMessages.slice(1).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: "Oops, I had trouble thinking about that one 😅 Try again in a moment!",
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div
      className="comic-box"
      style={{
        padding: '0',
        overflow: 'hidden',
        background: 'var(--paper-white)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '1rem 1.5rem',
          borderBottom: '2px solid var(--ink-black)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          background: 'linear-gradient(135deg, var(--marker-blue), #6366f1)',
        }}
      >
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            background: 'white',
            border: '2px solid var(--ink-black)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '2px 2px 0px var(--ink-black)',
          }}
        >
          <Sparkles size={22} color="var(--marker-blue)" />
        </div>
        <div>
          <div
            className="cartoon-font"
            style={{ fontSize: '1.6rem', color: 'white', lineHeight: 1 }}
          >
            Travi AI Agent
          </div>
          <div
            style={{
              fontSize: '0.8rem',
              color: 'rgba(255,255,255,0.8)',
              fontFamily: "'Nunito', sans-serif",
            }}
          >
            Ask anything about your itinerary
          </div>
        </div>
        <div
          style={{
            marginLeft: 'auto',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#4ade80',
            boxShadow: '0 0 6px #4ade80',
          }}
        />
      </div>

      {/* Quick Questions */}
      <div
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid #eee',
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
        }}
      >
        {QUICK_QUESTIONS.map((q, i) => (
          <button
            key={i}
            onClick={() => sendMessage(q.message)}
            disabled={loading}
            style={{
              padding: '4px 10px',
              borderRadius: '12px',
              border: '1.5px solid var(--ink-black)',
              background: 'white',
              fontSize: '0.8rem',
              fontFamily: "'Nunito', sans-serif",
              fontWeight: 'bold',
              cursor: loading ? 'wait' : 'pointer',
              transition: 'all 0.1s',
              boxShadow: '1px 1px 0px var(--ink-black)',
              whiteSpace: 'nowrap',
            }}
            onMouseOver={(e) => {
              if (!loading) {
                e.currentTarget.style.background = 'var(--marker-yellow)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'white';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Message Thread */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1rem',
          maxHeight: '350px',
          minHeight: '200px',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '80%',
                  padding: '0.75rem 1rem',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background:
                    msg.role === 'user'
                      ? 'var(--marker-blue)'
                      : 'white',
                  color: msg.role === 'user' ? 'white' : 'var(--ink-black)',
                  border: '2px solid var(--ink-black)',
                  boxShadow: '2px 2px 0px var(--ink-black)',
                  fontFamily: "'Nunito', sans-serif",
                  fontSize: '0.95rem',
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                }}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ display: 'flex', justifyContent: 'flex-start' }}
          >
            <div
              style={{
                padding: '0.75rem 1.25rem',
                borderRadius: '16px 16px 16px 4px',
                background: 'white',
                border: '2px solid var(--ink-black)',
                boxShadow: '2px 2px 0px var(--ink-black)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontFamily: "'Nunito', sans-serif",
                color: 'var(--text-secondary)',
              }}
            >
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Travi is thinking...
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div
        style={{
          padding: '0.75rem 1rem',
          borderTop: '2px solid var(--ink-black)',
          display: 'flex',
          gap: '8px',
          background: '#fafaf8',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your trip..."
          disabled={loading}
          aria-label="Chat message input"
          style={{
            flex: 1,
            padding: '0.75rem 1rem',
            borderRadius: '12px',
            border: '2px solid var(--ink-black)',
            fontFamily: "'Nunito', sans-serif",
            fontSize: '1rem',
            outline: 'none',
            boxShadow: '2px 2px 0px var(--ink-black)',
            background: 'white',
          }}
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          aria-label="Send message"
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            border: '2px solid var(--ink-black)',
            background:
              loading || !input.trim() ? '#ddd' : 'var(--marker-green)',
            color: loading || !input.trim() ? '#aaa' : 'white',
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow:
              loading || !input.trim()
                ? 'none'
                : '2px 2px 0px var(--ink-black)',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
        >
          <Send size={20} />
        </button>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
