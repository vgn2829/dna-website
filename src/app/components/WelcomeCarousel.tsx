import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import useEmblaCarousel from 'embla-carousel-react';

interface WelcomeCarouselProps {
  name: string;
  onDone: () => void;
}

const SLIDES = [
  {
    id: 'design-studio',
    symbol: '◆',
    title: 'Design Studio',
    desc: 'A set of creative tools — generate colour palettes, pair fonts, check contrast, and more.',
  },
  {
    id: 'academy',
    symbol: '◆',
    title: 'Academy',
    desc: 'Watch curated videos and track your learning progress across design domains.',
  },
  {
    id: 'moodboards',
    symbol: '◆',
    title: 'Moodboards',
    desc: 'Create collaborative visual boards. Add images, sketch ideas, and share with your team.',
  },
  {
    id: 'gallery',
    symbol: '◆',
    title: 'Gallery',
    desc: 'Explore artwork, illustrations, and animations from DnA Club members.',
  },
  {
    id: 'events',
    symbol: '◆',
    title: 'Events',
    desc: 'Join live sessions and workshops with real-time countdowns, so you never miss what the club has going on.',
  },
  {
    id: 'like-comment',
    symbol: '◆',
    title: 'Like & Comment',
    desc: 'React to posts and share your thoughts directly on any artwork.',
  },
] as const;

export default function WelcomeCarousel({ name, onDone }: WelcomeCarouselProps) {
  const navigate = useNavigate();
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false });
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setActiveIndex(emblaApi.selectedScrollSnap());
    onSelect();
    emblaApi.on('select', onSelect);
    return () => { emblaApi.off('select', onSelect); };
  }, [emblaApi]);

  const isFirstSlide = activeIndex === 0;
  const isLastSlide = activeIndex === SLIDES.length - 1;

  const handleExplore = () => {
    onDone();
    navigate('/gallery');
  };

  const handleNext = () => {
    if (isLastSlide) {
      handleExplore();
      return;
    }
    emblaApi?.scrollNext();
  };

  const handlePrevious = () => emblaApi?.scrollPrev();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-hairline)',
          borderRadius: 'var(--radius-xl)',
          padding: '40px 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-brand)',
            fontFamily: 'var(--font-body)',
          }}>
            Welcome to DnA Club
          </p>
          <h2 style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.5px',
            color: 'var(--color-ink)',
            fontFamily: 'var(--font-display)',
            lineHeight: 1.2,
          }}>
            You're in, {name.split(' ')[0]}.
          </h2>
          <p style={{
            margin: 0,
            fontSize: 14,
            color: 'var(--color-ink-muted)',
            fontFamily: 'var(--font-body)',
            lineHeight: 1.6,
          }}>
            Here's what you can explore on the website.
          </p>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--color-hairline)' }} />

        {/* Carousel */}
        <div>
          <div ref={emblaRef} style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex' }}>
              {SLIDES.map((slide) => (
                <div key={slide.id} style={{ flex: '0 0 100%', minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minHeight: 88 }}>
                    <span style={{
                      color: 'var(--color-brand)',
                      fontSize: 10,
                      marginTop: 4,
                      flexShrink: 0,
                      fontFamily: 'var(--font-body)',
                    }}>
                      {slide.symbol}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <p style={{
                        margin: 0,
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--color-ink)',
                        fontFamily: 'var(--font-body)',
                      }}>
                        {slide.title}
                      </p>
                      <p style={{
                        margin: 0,
                        fontSize: 13,
                        color: 'var(--color-ink-muted)',
                        fontFamily: 'var(--font-body)',
                        lineHeight: 1.5,
                      }}>
                        {slide.desc}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Dots */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 }}>
            {SLIDES.map((slide, index) => (
              <motion.button
                key={slide.id}
                onClick={() => emblaApi?.scrollTo(index)}
                aria-label={`Go to ${slide.title}`}
                initial={false}
                animate={{
                  opacity: index === activeIndex ? 1 : 0.5,
                  width: index === activeIndex ? 24 : 8,
                }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                style={{
                  height: 8,
                  borderRadius: 'var(--radius-full)',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  background: index === activeIndex ? 'var(--color-ink)' : 'var(--color-hairline)',
                }}
              />
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--color-hairline)' }} />

        {/* Footer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            {!isFirstSlide && (
              <button
                onClick={handlePrevious}
                style={{
                  padding: '14px 20px',
                  background: 'none',
                  color: 'var(--color-ink-muted)',
                  border: '1px solid var(--color-hairline)',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: 'var(--font-body)',
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            )}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleNext}
              style={{
                flex: 1,
                padding: '14px 24px',
                background: 'var(--color-brand)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-pill)',
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                letterSpacing: '0.02em',
              }}
            >
              {isLastSlide ? 'Explore Gallery' : 'Next'}
            </motion.button>
          </div>
          <button
            onClick={onDone}
            style={{
              width: '100%',
              padding: '12px 24px',
              background: 'none',
              color: 'var(--color-ink-muted)',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
            }}
          >
            Browse on my own
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
