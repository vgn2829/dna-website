import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, query } from './client';
import { initSchema } from './schema';

async function seed() {
  await initSchema();

  // Idempotent: skip if already seeded
  const existing = await query('SELECT COUNT(*) AS c FROM domains');
  if (Number((existing[0] as Record<string, unknown>).c) > 0) {
    console.log('Database already seeded — skipping.');
    return;
  }

  // Admin password
  const pw = process.env.ADMIN_PASSWORD ?? 'admin123';
  const hash = await bcrypt.hash(pw, 12);
  await query('INSERT INTO admin_config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', ['admin_password_hash', hash]);

  // Domains
  const domains = [
    {
      id: 'uiux', title: 'UI/UX Design', fullName: 'User Interface & Experience',
      icon: 'fa-wand-magic-sparkles',
      tagline: 'Figma Mastery, Design Systems, and Liquid Micro-Interactions',
      description: 'Explore the foundations of human-computer interaction, interactive prototypes, visual hierarchies, and modern responsive app flows.',
      color: '#007AFF', order: 0,
      videos: [
        { id: 'uiux-1', title: 'Figma Auto Layout 5.0 Deep Dive', ytId: 'Ib8UBwu3yGA', difficulty: 'Beginner', duration: '14 mins' },
        { id: 'uiux-2', title: 'Building Scalable UI Components and Variants', ytId: 'IyR_uYsRdPs', difficulty: 'Intermediate', duration: '18 mins' },
      ],
      quizzes: [{ q: 'Which Auto Layout property enables fluid wrapped components in Figma?', options: ['Fixed Constraints','Auto Layout Wrap','Smart Animate','Grid Overlays'], ans: 1 }],
    },
    {
      id: 'photoshop', title: 'Photoshop', fullName: 'Adobe Photoshop',
      icon: 'fa-images',
      tagline: 'Advanced Matte Painting, Composition & High-End Retouching',
      description: 'Learn non-destructive raster masking, custom smart filters, complex selection routines, and lighting integrations.',
      color: '#BF5AF2', order: 1,
      videos: [
        { id: 'ps-1', title: 'Layers & Advanced Matte Masking Techniques', ytId: 'R3M7q87A9yE', difficulty: 'Beginner', duration: '15 mins' },
        { id: 'ps-2', title: 'Color Integration & Cinematic Grading Match', ytId: 'gRWee_V08Wc', difficulty: 'Advanced', duration: '22 mins' },
      ],
      quizzes: [{ q: 'How is non-destructive coloring best applied to raw image layers?', options: ['Direct Brush rastering','Adjustment layers and Smart Objects','Merging visible layers','Decreasing canvas resolution'], ans: 1 }],
    },
    {
      id: 'illustrator', title: 'Illustrator', fullName: 'Adobe Illustrator',
      icon: 'fa-pen-nib',
      tagline: 'Logotypes, Golden Ratio Vector Grids, and Typography',
      description: 'Master clean scale-independent anchor layouts, custom lettering, shape builder algorithms, and printing templates.',
      color: '#FF9F0A', order: 2,
      videos: [
        { id: 'ai-1', title: 'Golden Ratio Grid Construction for Iconography', ytId: '7S0g_15pMlo', difficulty: 'Beginner', duration: '20 mins' },
        { id: 'ai-2', title: 'Pen Tool Curves Precision Workflows', ytId: 'dO_5V8Vf5q4', difficulty: 'Intermediate', duration: '15 mins' },
      ],
      quizzes: [{ q: 'Which tool combines overlapping vector shapes by dragging?', options: ['Lasso Tool','Direct Selection Arrow','Shape Builder Tool','Erase Brush'], ans: 2 }],
    },
    {
      id: 'animation', title: '3D Animation', fullName: '3D Artistry & CGI',
      icon: 'fa-cube',
      tagline: 'Blender Sculpting, PBR Shaders, and Cinematic Lighting',
      description: 'Deep dive into standard 3D asset generation, polygon mesh layouts, procedural textures, rigging, and keyframed physics.',
      color: '#FF375F', order: 3,
      videos: [
        { id: 'blender-1', title: '3D Geometry Modelling Nodes for Beginners', ytId: 'N9i8SAt0N_0', difficulty: 'Beginner', duration: '19 mins' },
        { id: 'blender-2', title: 'Procedural Glass Shader Rendering in Cycles', ytId: 'eW3zL1w7nEw', difficulty: 'Advanced', duration: '28 mins' },
      ],
      quizzes: [{ q: 'What texture mapping workflow is standard for high-fidelity realistic rendering?', options: ['Raster scanning','PBR (Physically Based Rendering)','Bilinear filtering','Flat shading'], ans: 1 }],
    },
  ];

  for (const d of domains) {
    await query(
      'INSERT INTO domains(id,title,full_name,icon,tagline,description,color,display_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [d.id, d.title, d.fullName, d.icon, d.tagline, d.description, d.color, d.order]
    );
    for (const v of d.videos) {
      await query('INSERT INTO videos(id,domain_id,title,yt_id,difficulty,duration) VALUES($1,$2,$3,$4,$5,$6)',
        [v.id, d.id, v.title, v.ytId, v.difficulty, v.duration]);
    }
    for (const q of d.quizzes) {
      await query('INSERT INTO quiz_questions(domain_id,question,options,answer_index) VALUES($1,$2,$3,$4)',
        [d.id, q.q, JSON.stringify(q.options), q.ans]);
    }
  }

  // Artworks (legacy image_url rows)
  const artworks = [
    { id: 'art-1', title: 'Ethereal Solitude - 3D Environment Space', artist: 'Vikram Aditya (Y23)', domain: '3D Animation', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80', likes: 42 },
    { id: 'art-2', title: 'Liquid Silicon iOS Interface Design', artist: 'Aranya Sen (Y24)', domain: 'UI/UX Design', url: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=800&q=80', likes: 68 },
    { id: 'art-3', title: 'Cyberpunk Varanasi Vector Graphic Art', artist: 'Rahul Verma (Y22)', domain: 'Illustrator', url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=800&q=80', likes: 55 },
    { id: 'art-4', title: 'Minimalist Vector Poster Study', artist: 'Sanya Dixit (Y23)', domain: 'Illustrator', url: 'https://images.unsplash.com/photo-1561070791-26c113006238?auto=format&fit=crop&w=800&q=80', likes: 29 },
    { id: 'art-5', title: 'CGI Procedural Glass & Fluid Simulation', artist: 'Vikram Aditya (Y23)', domain: '3D Animation', url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=800&q=80', likes: 81 },
    { id: 'art-6', title: 'Abstract Digital Composition', artist: 'Priya Nair (Y24)', domain: 'Photoshop', url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=800&q=80', likes: 34 },
  ];
  for (const a of artworks) {
    await query('INSERT INTO artworks(id,title,artist,domain,image_url,media_type,likes) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [a.id, a.title, a.artist, a.domain, a.url, 'image', a.likes]);
  }
  await query('INSERT INTO artwork_comments(id,artwork_id,sender,text) VALUES($1,$2,$3,$4)', ['c1','art-1','Aman Deep','This lighting render looks incredibly realistic!']);
  await query('INSERT INTO artwork_comments(id,artwork_id,sender,text) VALUES($1,$2,$3,$4)', ['c2','art-1','Sanya Gupta','Fantastic atmospheric depth in the background clouds.']);
  await query('INSERT INTO artwork_comments(id,artwork_id,sender,text) VALUES($1,$2,$3,$4)', ['c3','art-2','Prof. Roy','Beautiful implementation of organic gradients.']);

  // Events
  const events = [
    { id: 'evt-1', title: 'Figma iOS 26 UI Sprint: Liquid Glass Design', date: '2026-06-12', time: '6:00 PM – 8:30 PM', location: 'Lecture Hall Complex (LHC-3)', content: 'Interactive masterclass on structural glassmorphism, adaptive blur states, responsive container constraints, and prototyping realistic gestures.', cap: 120, reg: 94 },
    { id: 'evt-2', title: 'CGI Blender Sculpting & Fluid Physics', date: '2026-06-28', time: '5:30 PM – 8:00 PM', location: 'Computer Centre Lab 2', content: 'Learn to bake ultra-smooth glass-like fluid simulations, optimize particle constraints, and render high-resolution lighting rigs.', cap: 80, reg: 45 },
    { id: 'evt-3', title: 'Photoshop Matte Painting Bootcamp', date: '2026-07-05', time: '4:00 PM – 7:00 PM', location: 'SAC Design Studio', content: 'Hands-on bootcamp for cinematic compositing, sky replacement, and advanced layer techniques with real-world project files.', cap: 60, reg: 18 },
  ];
  for (const e of events) {
    await query('INSERT INTO events(id,title,date,time,location,content,capacity,registered_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [e.id, e.title, e.date, e.time, e.location, e.content, e.cap, e.reg]);
  }

  // Team members (migrated from static data)
  const members = [
    { name: 'Prof. Anupam Saxena', designation: 'Faculty Advisor', year: 'Department of Mechanical Engineering', bio: "Professor Saxena has been guiding DAC since its inception, providing mentorship in design thinking and creative leadership.", color: '#007AFF', order: 0, email: 'anupam@iitk.ac.in', linkedin: '#' },
    { name: 'Arjun Sharma', designation: 'Club Coordinator', year: 'Y4 · CSE', bio: "Leading the club's vision and strategy, Arjun has organized 20+ events and grown membership by 200% in two years.", color: '#007AFF', order: 1, instagram: '#', linkedin: '#', email: 'arjun@iitk.ac.in' },
    { name: 'Meera Patel', designation: 'Club Coordinator', year: 'Y3 · EE', bio: "Meera drives the creative direction, overseeing design systems and brand consistency across all club outputs.", color: '#BF5AF2', order: 2, instagram: '#', linkedin: '#', email: 'meera@iitk.ac.in' },
    { name: 'Rahul Verma', designation: 'Design Secretary', year: 'Y3 · AE', bio: "Rahul specializes in brand identity and UI/UX, leading design workshops each semester.", color: '#FF375F', order: 3, instagram: '#', linkedin: '#', email: 'rahul@iitk.ac.in' },
    { name: 'Priya Singh', designation: 'Animation Secretary', year: 'Y2 · ME', bio: "Priya heads all motion graphics and 3D animation initiatives, with work featured at national student showcases.", color: '#00D4FF', order: 4, instagram: '#', email: 'priya@iitk.ac.in' },
    { name: 'Karan Malhotra', designation: 'Events Secretary', year: 'Y3 · ChE', bio: "Karan coordinates logistics and outreach for all club events, building partnerships with companies and alumni.", color: '#FF9500', order: 5, instagram: '#', email: 'karan@iitk.ac.in' },
    { name: 'Anjali Reddy', designation: 'Media Secretary', year: 'Y2 · IME', bio: "Anjali manages all social media channels and documentation, growing the club's online presence to 10k+ followers.", color: '#34C759', order: 6, instagram: '#', email: 'anjali@iitk.ac.in' },
  ];
  for (const m of members) {
    await query(
      'INSERT INTO team_members(name,designation,year,bio,color,display_order,social_instagram,social_linkedin,social_email) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [m.name, m.designation, m.year, m.bio, m.color, m.order, (m as Record<string, unknown>).instagram ?? null, (m as Record<string, unknown>).linkedin ?? null, (m as Record<string, unknown>).email ?? null]
    );
  }

  console.log('Database seeded successfully.');
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); }).finally(() => pool.end());
