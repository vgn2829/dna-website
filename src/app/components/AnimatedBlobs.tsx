export function AnimatedBlobs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-30 blur-3xl animate-blob"
        style={{
          background: 'radial-gradient(circle, #007AFF 0%, transparent 70%)'
        }}
      />
      <div className="absolute top-1/3 right-1/4 w-80 h-80 rounded-full opacity-30 blur-3xl animate-blob animation-delay-2000"
        style={{
          background: 'radial-gradient(circle, #BF5AF2 0%, transparent 70%)'
        }}
      />
      <div className="absolute bottom-1/4 left-1/3 w-72 h-72 rounded-full opacity-30 blur-3xl animate-blob animation-delay-4000"
        style={{
          background: 'radial-gradient(circle, #FF375F 0%, transparent 70%)'
        }}
      />

      <div className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 50%, rgba(0, 122, 255, 0.1) 0%, transparent 50%)',
          animation: 'pulse 4s ease-in-out infinite'
        }}
      />
    </div>
  );
}
