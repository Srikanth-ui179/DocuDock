/* eslint-disable @typescript-eslint/no-unused-vars */
import { generateMockEmbedding } from '../src/lib/ai/mockProvider.ts';

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
function fnv1a(str) {
  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'can\'t', 'cannot', 'could', 'couldn\'t',
  'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
  'each', 'few', 'for', 'from', 'further',
  'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here',
  'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s',
  'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself',
  'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my', 'myself',
  'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such',
  'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they',
  'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very',
  'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s',
  'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t',
  'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
  // Meta-document query filler:
  'according', 'topics', 'covered', 'mention', 'mentions', 'mentioned', 'discuss', 'discusses', 'discussed',
  'tell', 'explain', 'show', 'pdf', 'doc', 'document', 'page', 'pages'
]);

function tokenize(text) {
  return text.toLowerCase().match(/\b[a-z0-9_]{2,}\b/g) || [];
}

function generateTfIdfEmbedding(text, dimension = 768) {
  const words = tokenize(text);
  const tf = new Map();
  for (const w of words) tf.set(w, (tf.get(w) || 0) + 1);

  const acc = new Float64Array(dimension);
  for (const [w, count] of tf.entries()) {
    const weight = STOP_WORDS.has(w) ? 0.02 : (1.0 + Math.log(count));
    let state = fnv1a(w);
    for (let i = 0; i < dimension; i++) {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      acc[i] += weight * ((state / 4294967295) * 2 - 1);
    }
  }
  let sumSq = 0;
  for (let i = 0; i < dimension; i++) sumSq += acc[i] * acc[i];
  const norm = Math.sqrt(sumSq) || 1.0;
  const result = new Array(dimension);
  for (let i = 0; i < dimension; i++) result[i] = acc[i] / norm;
  return result;
}

const chunks = [
  {
    name: 'Chunk 0 (Overview/Scope)',
    page: 1,
    text: 'BP 201T. HUMAN ANATOMY AND PHYSIOLOGY-II (Theory) 45 Hours Scope: This subject is designed to impart fundamental knowledge on the structure and functions of the various systems of the human body. It also helps in understanding both homeostatic mechanisms. The subject provides the basic knowledge required to understand the various disciplines of pharmacy. Objectives: Upon completion of this course the student should be able to: 1. Explain the gross morphology, structure and functions of various organs of the human body. 2. Describe the various homeostatic mechanisms and their imbalances. 3. Identify the various tissues and organs of different systems of human body. 4.'
  },
  {
    name: 'Chunk 1 (Nervous system I)',
    page: 1,
    text: 'atic mechanisms and their imbalances. 3. Identify the various tissues and organs of different systems of human body. 4. Perform the hematological tests like blood cell counts, haemoglobin estimation, bleeding/clotting time etc and also record blood pressure, heart rate, pulse and respiratory volume. 5. Appreciate coordinated working pattern of different organs of each system 6. Appreciate the interlinked mechanisms in the maintenance of normal functioning (homeostasis) of human body. Course Content: Unit I 10 hours Nervous system Organization of nervous system, neuron, neuroglia, classification and properties of nerve fibre, electrophysiology, action potential, nerve impulse, receptors, synapse, neurotransmitters.'
  },
  {
    name: 'Chunk 2 (CNS & Digestive I)',
    page: 1,
    text: 'd properties of nerve fibre, electrophysiology, action potential, nerve impulse, receptors, synapse, neurotransmitters. Central nervous system: Meninges, ventricles of brain and cerebrospinal fluid.structure and functions of brain (cerebrum, brain stem, cerebellum), spinal cord (gross structure, functions of afferent and efferent nerve tracts,reflex activity) Unit II 06 hours Digestive system Anatomy of GI Tract with special reference to anatomy and functions of stomach, ( Acid production in the stomach, regulation of acid production through parasympathetic nervous system, pepsin role in protein digestion) small intestine 54'
  },
  {
    name: 'Chunk 3 (Digestive II & Respiratory & Urinary)',
    page: 2,
    text: 'and large intestine, anatomy and functions of salivary glands, pancreas and liver, movements of GIT, digestion and absorption of nutrients and disorders of GIT. Energetics Formation and role of ATP, Creatinine Phosphate and BMR. Unit III Respiratory system 10 hours Anatomy of respiratory system with special reference to anatomy of lungs, mechanism of respiration, regulation of respiration Lung Volumes and capacities transport of respiratory gases, artificial respiration, and resuscitation methods. Urinary system Anatomy of urinary tract with special reference to anatomy of kidney and nephrons, functions of kidney and urinary tract, physiology of urine formation, micturition reflex and role of kidneys in acid base balance, role of RAS in kidney and disorders of kidney.'
  },
  {
    name: 'Chunk 4 (Endocrine & Reproductive & Genetics)',
    page: 2,
    text: 'formation, micturition reflex and role of kidneys in acid base balance, role of RAS in kidney and disorders of kidney. Unit IV 10 hours Endocrine system Classification of hormones, mechanism of hormone action, structure and functions of pituitary gland, thyroid gland, parathyroid gland, adrenal gland, pancreas, pineal gland, thymus and their disorders. Unit V 09 hours Reproductive system Anatomy of male and female reproductive system, Functions of male and female reproductive system, sex hormones, physiology of menstruation, fertilization, spermatogenesis, oogenesis, pregnancy and parturition Introduction to genetics Chromosomes, genes and DNA, protein synthesis, genetic pattern of inheritance 55'
  }
];

function testQuery(q) {
  console.log('\n>>> Query:', q);
  const qEmb = generateTfIdfEmbedding(q);
  const scored = chunks.map(c => {
    const cEmb = generateTfIdfEmbedding(c.text);
    let dot = 0;
    for (let i = 0; i < 768; i++) dot += qEmb[i] * cEmb[i];
    return { name: c.name, page: c.page, score: dot };
  });
  scored.sort((a, b) => b.score - a.score);
  scored.forEach(s => console.log('  ' + s.score.toFixed(4) + ' -> ' + s.name + ' (p. ' + s.page + ')'));
}

testQuery('According to HAP 2.pdf, what topics are covered under the respiratory system?');
testQuery('What does the document say about the nervous system and brain?');
testQuery('Explain the digestive system and stomach acid production');
testQuery('What are the endocrine glands and hormones?');
testQuery('What is quantum electrodynamics in particle physics?');
