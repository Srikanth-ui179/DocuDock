import { generateMockEmbedding } from '../src/lib/ai/mockProvider.ts';

const chunks = [
  {
    index: 0,
    page: 1,
    content: 'BP 201T. HUMAN ANATOMY AND PHYSIOLOGY-II (Theory) 45 Hours Scope: This subject is designed to impart fundamental knowledge on the structure and functions of the various systems of the human body. It also helps in understanding both homeostatic mechanisms. The subject provides the basic knowledge required to understand the various disciplines of pharmacy. Objectives: Upon completion of this course the student should be able to: 1. Explain the gross morphology, structure and functions of various organs of the human body. 2. Describe the various homeostatic mechanisms and their imbalances. 3. Identify the various tissues and organs of different systems of human body. 4.'
  },
  {
    index: 1,
    page: 1,
    content: 'atic mechanisms and their imbalances. 3. Identify the various tissues and organs of different systems of human body. 4. Perform the hematological tests like blood cell counts, haemoglobin estimation, bleeding/clotting time etc and also record blood pressure, heart rate, pulse and respiratory volume. 5. Appreciate coordinated working pattern of different organs of each system 6. Appreciate the interlinked mechanisms in the maintenance of normal functioning (homeostasis) of human body. Course Content: Unit I 10 hours  Nervous system Organization of nervous system, neuron, neuroglia, classification and properties of nerve fibre, electrophysiology, action potential, nerve impulse, receptors, synapse, neurotransmitters.'
  },
  {
    index: 2,
    page: 1,
    content: 'd properties of nerve fibre, electrophysiology, action potential, nerve impulse, receptors, synapse, neurotransmitters. Central nervous system: Meninges, ventricles of brain and cerebrospinal fluid.structure and functions of brain (cerebrum, brain stem, cerebellum), spinal cord (gross structure, functions of afferent and efferent nerve tracts,reflex activity) Unit II 06 hours  Digestive system Anatomy of GI Tract with special reference to anatomy and functions of stomach, ( Acid production in the stomach, regulation of acid production through parasympathetic nervous system, pepsin role in protein digestion) small intestine 54'
  },
  {
    index: 3,
    page: 2,
    content: 'and large intestine, anatomy and functions of salivary glands, pancreas and liver, movements of GIT, digestion and absorption of nutrients and disorders of GIT.  Energetics Formation and role of ATP, Creatinine Phosphate and BMR. Unit III  Respiratory system 10 hours Anatomy of respiratory system with special reference to anatomy of lungs, mechanism of respiration, regulation of respiration Lung Volumes and capacities transport of respiratory gases, artificial respiration, and resuscitation methods.  Urinary system Anatomy of urinary tract with special reference to anatomy of kidney and nephrons, functions of kidney and urinary tract, physiology of urine formation, micturition reflex and role of kidneys in acid base balance, role of RAS in kidney and disorders of kidney.'
  },
  {
    index: 4,
    page: 2,
    content: 'formation, micturition reflex and role of kidneys in acid base balance, role of RAS in kidney and disorders of kidney.  Unit IV 10 hours   Endocrine system Classification of hormones, mechanism of hormone action, structure and functions of pituitary gland, thyroid gland, parathyroid gland, adrenal gland, pancreas, pineal gland, thymus and their disorders. Unit V 09 hours  Reproductive system Anatomy of male and female reproductive system, Functions of male and female reproductive system, sex hormones, physiology of menstruation, fertilization, spermatogenesis, oogenesis, pregnancy and parturition  Introduction to genetics Chromosomes, genes and DNA, protein synthesis, genetic pattern of inheritance 55'
  }
];

const query = 'According to HAP 2.pdf, what topics are covered under the respiratory system?';
const qEmb = generateMockEmbedding(query);

console.log('Query:', query);
const scores = [];
chunks.forEach(c => {
  const cEmb = generateMockEmbedding(c.content);
  let dot = 0;
  for (let i = 0; i < 768; i++) dot += qEmb[i] * cEmb[i];
  scores.push({ index: c.index, page: c.page, similarity: dot, content: c.content.slice(0, 70) });
});

scores.sort((a, b) => b.similarity - a.similarity);
scores.forEach(s => {
  console.log(`Chunk ${s.index} (Page ${s.page}): similarity = ${s.similarity.toFixed(4)} | "${s.content}..."`);
});
