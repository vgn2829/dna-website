import { motion } from 'motion/react';
import { Calendar, MapPin, Clock, Users, ArrowRight } from 'lucide-react';
import { GlassButton } from '../../imports/pasted_text/displacement-map';
import { useNavigate } from 'react-router';

interface Event {
  id: number;
  title: string;
  date: string;
  time: string;
  location: string;
  description: string;
  capacity: number;
  status: 'upcoming' | 'live' | 'past';
  month: string;
  day: string;
}

export function Events() {
  const navigate = useNavigate();
  const events: Event[] = [
    {
      id: 1,
      title: 'UI/UX Design Workshop',
      date: '2026-05-25',
      time: '4:00 PM - 6:00 PM',
      location: 'LHC Auditorium',
      description: 'Learn the fundamentals of user interface and experience design with industry experts.',
      capacity: 80,
      status: 'upcoming',
      month: 'MAY',
      day: '25'
    },
    {
      id: 2,
      title: 'Blender Masterclass',
      date: '2026-06-05',
      time: '5:00 PM - 7:00 PM',
      location: 'CC Lab 2',
      description: 'Advanced 3D modeling and rendering techniques for creating stunning visuals.',
      capacity: 50,
      status: 'upcoming',
      month: 'JUN',
      day: '05'
    },
    {
      id: 3,
      title: 'Motion Graphics Bootcamp',
      date: '2026-06-12',
      time: '3:00 PM - 6:00 PM',
      location: 'Design Studio',
      description: 'Create compelling animations and motion graphics using After Effects.',
      capacity: 60,
      status: 'upcoming',
      month: 'JUN',
      day: '12'
    }
  ];

  return (
    <section id="events" className="relative py-24 px-6">
      <div className="page-container">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4">
            Upcoming <span className="gradient-text">Events</span>
          </h2>
          <p className="text-white/70 text-lg max-w-2xl mx-auto">
            Join us for workshops, exhibitions, and creative sessions
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {events.map((event, index) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ y: -8 }}
              className="glass-strong glass-hover rounded-3xl overflow-hidden group cursor-pointer"
              onClick={() => navigate('/events')}
            >
              <div className="relative h-48 overflow-hidden">
                <div
                  className="absolute inset-0 transition-transform duration-500 group-hover:scale-110"
                  style={{
                    background: `linear-gradient(135deg, ${
                      index % 3 === 0 ? '#007AFF' : index % 3 === 1 ? '#BF5AF2' : '#FF375F'
                    } 0%, transparent 100%)`
                  }}
                />

                <motion.div
                  className="absolute top-6 left-6 glass p-4 rounded-2xl text-center min-w-[4rem]"
                  whileHover={{ scale: 1.1, rotateY: 180 }}
                  transition={{ type: 'spring', stiffness: 300 }}
                >
                  <div className="text-xs font-semibold text-white/80">
                    {event.month}
                  </div>
                  <div className="text-3xl font-bold">{event.day}</div>
                </motion.div>

                {event.status === 'live' && (
                  <div className="absolute top-6 right-6 px-3 py-1 rounded-full glass flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-xs font-semibold">LIVE</span>
                  </div>
                )}
              </div>

              <div className="p-6">
                <h3 className="text-xl font-bold mb-3 group-hover:gradient-text transition-all">
                  {event.title}
                </h3>

                <p className="text-white/70 text-sm mb-4 line-clamp-2">
                  {event.description}
                </p>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-sm text-white/70">
                    <Clock size={16} />
                    <span>{event.time}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-white/70">
                    <MapPin size={16} />
                    <span>{event.location}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-white/70">
                    <Users size={16} />
                    <span>Capacity: {event.capacity}</span>
                  </div>
                </div>

                <GlassButton
                  className="w-full inline-flex items-center justify-center gap-2 group/btn"
                  onClick={() => navigate('/events')}
                >
                  Register Now
                  <ArrowRight
                    size={16}
                    className="group-hover/btn:translate-x-1 transition-transform"
                  />
                </GlassButton>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center mt-12"
        >
          <GlassButton size="lg" onClick={() => navigate('/events')}>
            View All Events
          </GlassButton>
        </motion.div>
      </div>
    </section>
  );
}