// Domain and study-type filters, and the translation of a topic into the
// query syntax of each source.

const kw = (words) => `(${words.map((w) => `TITLE:"${w}" OR ABSTRACT:"${w}"`).join(" OR ")})`;

export const DOMAINS = [
  { id: "oncology", label: "Oncology", pubmed: '"Neoplasms"[MeSH Terms]', epmc: kw(["cancer", "tumor", "neoplasm", "carcinoma"]) },
  { id: "cardiology", label: "Cardiology", pubmed: '"Cardiovascular Diseases"[MeSH Terms]', epmc: kw(["cardiovascular", "cardiac", "heart failure", "coronary"]) },
  { id: "neurology", label: "Neurology", pubmed: '"Nervous System Diseases"[MeSH Terms]', epmc: kw(["neurological", "neurodegenerative", "stroke", "epilepsy"]) },
  { id: "psychiatry", label: "Psychiatry & mental health", pubmed: '"Mental Disorders"[MeSH Terms]', epmc: kw(["psychiatric", "mental health", "depression", "anxiety"]) },
  { id: "infectious", label: "Infectious disease", pubmed: '"Infections"[MeSH Terms]', epmc: kw(["infection", "infectious", "antimicrobial", "viral"]) },
  { id: "immunology", label: "Immunology", pubmed: '("Immune System Diseases"[MeSH Terms] OR "Immunity"[MeSH Terms])', epmc: kw(["immune", "immunology", "autoimmune", "immunotherapy"]) },
  { id: "endocrinology", label: "Endocrinology & metabolism", pubmed: '("Endocrine System Diseases"[MeSH Terms] OR "Metabolic Diseases"[MeSH Terms])', epmc: kw(["diabetes", "endocrine", "metabolic", "obesity"]) },
  { id: "genetics", label: "Genetics & genomics", pubmed: '("Genetics"[MeSH Terms] OR "Genomics"[MeSH Terms])', epmc: kw(["genetic", "genomic", "gene", "sequencing"]) },
  { id: "pharmacology", label: "Pharmacology", pubmed: '("Pharmacology"[MeSH Terms] OR "Drug Therapy"[MeSH Terms])', epmc: kw(["pharmacology", "pharmacokinetics", "drug therapy", "dose"]) },
  { id: "publichealth", label: "Public health & epidemiology", pubmed: '("Public Health"[MeSH Terms] OR "Epidemiology"[MeSH Terms])', epmc: kw(["public health", "epidemiology", "population-based", "prevalence"]) },
  { id: "pediatrics", label: "Pediatrics", pubmed: '("Child"[MeSH Terms] OR "Infant"[MeSH Terms] OR "Adolescent"[MeSH Terms])', epmc: kw(["children", "pediatric", "paediatric", "adolescents"]) },
  { id: "microbiology", label: "Microbiology & microbiome", pubmed: '("Microbiology"[MeSH Terms] OR "Microbiota"[MeSH Terms])', epmc: kw(["microbiome", "microbiota", "bacterial", "microbial"]) },
  { id: "ai", label: "AI & digital health", pubmed: '("Artificial Intelligence"[MeSH Terms] OR "Telemedicine"[MeSH Terms])', epmc: kw(["machine learning", "deep learning", "artificial intelligence", "digital health"]) },
];

export const STUDY_TYPES = [
  { id: "rct", label: "Randomized trials", pubmed: '"Randomized Controlled Trial"[Publication Type]', epmc: 'PUB_TYPE:"Randomized Controlled Trial"' },
  { id: "trial", label: "Clinical trials", pubmed: '"Clinical Trial"[Publication Type]', epmc: 'PUB_TYPE:"Clinical Trial"' },
  { id: "meta", label: "Meta-analyses", pubmed: '"Meta-Analysis"[Publication Type]', epmc: 'PUB_TYPE:"Meta-Analysis"' },
  { id: "sr", label: "Systematic reviews", pubmed: '"Systematic Review"[Publication Type]', epmc: 'PUB_TYPE:"Systematic Review"' },
  { id: "observational", label: "Observational studies", pubmed: '"Observational Study"[Publication Type]', epmc: 'PUB_TYPE:"Observational Study"' },
  { id: "review", label: "Reviews", pubmed: '"Review"[Publication Type]', epmc: 'PUB_TYPE:"Review"' },
];

const pick = (list, ids) => list.filter((x) => (ids || []).includes(x.id));
const ymd = (d, sep) => d.toISOString().slice(0, 10).replaceAll("-", sep);

/** Build the source-specific query strings for a topic (without date limits). */
export function buildQueries(topic) {
  const domains = pick(DOMAINS, topic.domains);
  const types = pick(STUDY_TYPES, topic.studyTypes);
  const base = `(${topic.query.trim()})`;

  const pubmed = [base];
  const epmc = [base];
  if (domains.length) {
    pubmed.push(`(${domains.map((d) => d.pubmed).join(" OR ")})`);
    epmc.push(`(${domains.map((d) => d.epmc).join(" OR ")})`);
  }
  if (types.length) {
    pubmed.push(`(${types.map((t) => t.pubmed).join(" OR ")})`);
    epmc.push(`(${types.map((t) => t.epmc).join(" OR ")})`);
  }
  if (topic.englishOnly) {
    pubmed.push("english[Language]");
    epmc.push('LANG:"eng"');
  }
  if (topic.humansOnly) pubmed.push('"Humans"[MeSH Terms]');
  if (!topic.includePreprints) epmc.push("(SRC:MED OR SRC:PMC)");

  return { pubmed: pubmed.join(" AND "), europepmc: epmc.join(" AND ") };
}

export const pubmedDate = (d) => ymd(d, "/");
export const epmcDateRange = (from, to) => `FIRST_PDATE:[${ymd(from, "-")} TO ${ymd(to, "-")}]`;
