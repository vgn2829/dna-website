import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Video, Trophy, ArrowRight, Search, ExternalLink, Clock, Star, Filter } from 'lucide-react';
import { GlassButton } from '../../imports/pasted_text/displacement-map';

interface Resource {
  id: number;
  title: string;
  author: string;
  domain: string;
  type: 'video' | 'article' | 'course';
  duration: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  rating: number;
  color: string;
  tags: string[];
}

const domains = ['All', 'UI/UX Design', 'Illustrator', 'Photoshop', '3D Animation', 'After Effects', 'Blender', 'Figma'];

const resources: Resource[] = [
  { id: 1, title: 'UI Design Fundamentals', author: 'Sneha Mehta', domain: 'UI/UX Design', type: 'course', duration: '4h 30m', level: 'Beginner', rating: 4.9, color: '#007AFF', tags: ['Layout', 'Typography', 'Color'] },
  { id: 2, title: 'Vector Illustration Mastery', author: 'Rahul Kumar', domain: 'Illustrator', type: 'course', duration: '6h 15m', level: 'Intermediate', rating: 4.8, color: '#BF5AF2', tags: ['Vectors', 'Paths', 'Bezier'] },
  { id: 3, title: 'Photomanipulation Techniques', author: 'Priya Sharma', domain: 'Photoshop', type: 'video', duration: '2h 45m', level: 'Advanced', rating: 4.7, color: '#FF375F', tags: ['Compositing', 'Masking', 'Retouching'] },
  { id: 4, title: 'Blender Character Modeling', author: 'Amit Patel', domain: '3D Animation', type: 'course', duration: '8h 00m', level: 'Intermediate', rating: 4.9, color: '#00D4FF', tags: ['Modeling', 'Rigging', 'Render'] },
  { id: 5, title: 'Motion Graphics Essentials', author: 'Karan Verma', domain: 'After Effects', type: 'video', duration: '3h 20m', level: 'Beginner', rating: 4.6, color: '#FF9500', tags: ['Keyframes', 'Easing', 'Expressions'] },
  { id: 6, title: 'Blender Geometry Nodes', author: 'Anjali Reddy', domain: 'Blender', type: 'article', duration: '45m read', level: 'Advanced', rating: 4.8, color: '#34C759', tags: ['Procedural', 'Nodes', 'Animation'] },
  { id: 7, title: 'Figma Auto-Layout Deep Dive', author: 'Meera Patel', domain: 'Figma', type: 'video', duration: '1h 10m', level: 'Intermediate', rating: 4.9, color: '#FF375F', tags: ['Components', 'Variants', 'Tokens'] },
  { id: 8, title: 'Color Theory for Designers', author: 'Arjun Sharma', domain: 'UI/UX Design', type: 'article', duration: '30m read', level: 'Beginner', rating: 4.7, color: '#007AFF', tags: ['Color', 'Palette', 'Psychology'] },
  { id: 9, title: 'Illustrator Pen Tool Secrets', author: 'Rahul Kumar', domain: 'Illustrator', type: 'video', duration: '1h 50m', level: 'Intermediate', rating: 4.6, color: '#BF5AF2', tags: ['Pen Tool', 'Curves', 'Precision'] },
  { id: 10, title: 'Cinematic Color Grading', author: 'Priya Sharma', domain: 'Photoshop', type: 'course', duration: '2h 30m', level: 'Advanced', rating: 4.8, color: '#FF375F', tags: ['LUTs', 'Curves', 'Film'] },
  { id: 11, title: 'After Effects Rigging', author: 'Karan Verma', domain: 'After Effects', type: 'video', duration: '2h 00m', level: 'Advanced', rating: 4.7, color: '#FF9500', tags: ['Puppet', 'Duik', 'Character'] },
  { id: 12, title: '3D Environment Design', author: 'Amit Patel', domain: '3D Animation', type: 'course', duration: '5h 45m', level: 'Intermediate', rating: 4.9, color: '#00D4FF', tags: ['Lighting', 'HDRI', 'Textures'] },
];

const typeIcons = {
  video: Video,
  article: BookOpen,
  course: Trophy,
};

const levelColors = {
  Beginner: '#34C759',
  Intermediate: '#FF9500',
  Advanced: '#FF375F',
};

export function ResourcesPage() {
  const [selectedDomain, setSelectedDomain] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('All');

  const filtered = resources.filter((r) => {
    const domainMatch = selectedDomain === 'All' || r.domain === selectedDomain;
    const typeMatch = selectedType === 'All' || r.type === selectedType;
    const searchMatch =
      !searchQuery ||
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return domainMatch && typeMatch && searchMatch;
  });

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="page-container">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-6">
            <BookOpen size={16} className="text-blue-400" />
            <span className="text-sm font-medium text-white/80">Learning Hub</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-5">
            Learning <span className="gradient-text">Resources</span>
          </h1>
          <p className="text-white/60 text-lg max-w-2xl mx-auto">
            Curated tutorials, courses & guides to help you master design and animation — hand-picked by club members.
          </p>
        </motion.div>

        {/* Search & Filters */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-strong rounded-3xl p-6 mb-10"
        >
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                placeholder="Search resources, authors, tags…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-blue-400/50 transition-colors"
              />
            </div>
            <div className="flex gap-2">
              {['All', 'video', 'article', 'course'].map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedType(t)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-all ${
                    selectedType === t
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-400/30'
                      : 'glass text-white/60 hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {domains.map((domain) => (
              <button
                key={domain}
                onClick={() => setSelectedDomain(domain)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  selectedDomain === domain
                    ? 'bg-white text-black'
                    : 'glass text-white/60 hover:text-white'
                }`}
              >
                {domain}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Results count */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-white/50 text-sm">
            <span className="text-white font-semibold">{filtered.length}</span> resources found
          </p>
          <div className="flex items-center gap-2 text-white/40 text-sm">
            <Filter size={14} />
            Filtered results
          </div>
        </div>

        {/* Resource Cards */}
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((resource, index) => {
              const TypeIcon = typeIcons[resource.type];
              return (
                <motion.div
                  key={resource.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: index * 0.05 }}
                  whileHover={{ y: -6, scale: 1.01 }}
                  className="glass-strong glass-hover rounded-3xl overflow-hidden group cursor-pointer"
                >
                  {/* Card top bar */}
                  <div
                    className="h-2 w-full"
                    style={{ background: resource.color }}
                  />

                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ background: `${resource.color}22`, border: `1px solid ${resource.color}44` }}
                      >
                        <TypeIcon size={18} style={{ color: resource.color }} />
                      </div>
                      <div className="flex items-center gap-1">
                        <Star size={12} className="text-yellow-400 fill-yellow-400" />
                        <span className="text-sm font-semibold text-white/80">{resource.rating}</span>
                      </div>
                    </div>

                    <h3 className="text-lg font-bold mb-1 group-hover:gradient-text transition-all leading-tight">
                      {resource.title}
                    </h3>
                    <p className="text-white/50 text-sm mb-4">by {resource.author}</p>

                    <div className="flex flex-wrap gap-1.5 mb-5">
                      {resource.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-full text-xs font-medium glass"
                          style={{ color: resource.color }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3 text-white/50">
                        <div className="flex items-center gap-1">
                          <Clock size={12} />
                          {resource.duration}
                        </div>
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{
                            background: `${levelColors[resource.level]}22`,
                            color: levelColors[resource.level],
                            border: `1px solid ${levelColors[resource.level]}44`,
                          }}
                        >
                          {resource.level}
                        </span>
                      </div>
                      <ExternalLink size={14} className="text-white/30 group-hover:text-white/70 transition-colors" />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>

        {filtered.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-24"
          >
            <p className="text-white/40 text-lg">No resources match your search.</p>
            <button
              onClick={() => { setSearchQuery(''); setSelectedDomain('All'); setSelectedType('All'); }}
              className="mt-4 text-blue-400 hover:text-blue-300 text-sm font-semibold"
            >
              Clear filters
            </button>
          </motion.div>
        )}

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 glass-strong rounded-3xl p-10 text-center"
        >
          <h3 className="text-2xl font-bold mb-3">Have a resource to share?</h3>
          <p className="text-white/60 mb-6 max-w-md mx-auto">
            Found something amazing? Submit it to our curated library and help the community grow.
          </p>
          <GlassButton
            size="lg"
            className="inline-flex items-center gap-2 group"
            glassColor="oklch(from var(--foreground) l c h / 15%)"
            style={{ background: 'linear-gradient(135deg, #007AFF 0%, #BF5AF2 100%)' }}
          >
            Submit a Resource
            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </GlassButton>
        </motion.div>
      </div>
    </div>
  );
}
