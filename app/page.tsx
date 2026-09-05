'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, CheckCircle2, CircleAlert, Clock3, Download, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type AnyRecord = Record<string, unknown>;
type Phase = 'Phase A' | 'Phase B';
type Screen = 'welcome' | 'profile' | 'instructions' | 'review' | 'phase-transition' | 'questionnaire' | 'contact' | 'complete';
type ClinicalField = { predictor: string; name: string; value: string; timing?: string; distinctDates?: string; chronologyNote?: string };
type Factor = { predictor: string; name: string; value: string; unit: string; direction: string; contribution?: string };
type TrajectoryPoint = { relativeDay: number; value: number };
type Trajectory = { predictor: string; name: string; unit: string; points: TrajectoryPoint[] };
type ReviewCase = { caseCode: string; fields: ClinicalField[]; trajectories: Trajectory[]; score?: string; tier?: string; factors?: Factor[] };
type OrderRow = { clinician: string; phase: Phase; caseCode: string; order: number };
type Answer = { concern: string; review: string; sufficiency: string; confidence: string; usefulness?: string; clarity?: string; changed?: string; rationale?: string; savedAt: string; reviewTimeSeconds: number };
type Profile = { participantCode: string; specialty: string; experience: string; aiExperience: string; institution: string };
type PilotFeedback = { phaseAAnswerable?: string; missingInformation?: string; unclearTerminology?: string; phaseBInterpretation?: string; technicalProblem?: string; overallComment?: string };
type ContactDetails = { fullName: string; email: string; phone: string; findings: boolean; interview: boolean; paper: boolean };
type SubmissionStatus = 'idle' | 'submitting' | 'submitted' | 'failed' | 'not-configured';

const CASE_KEYS = ['case_code', 'Case code', 'caseCode', 'anonymous_case_code'];
const POST_ITEMS = [
  ['score_clear', 'The meaning of the CKD-review score and ranking was clear.'],
  ['explanation_clear', 'The SHAP explanation was easy to understand without technical support.'],
  ['direction_clear', 'The display clearly distinguished factors contributing toward higher or lower CKD-review ranking.'],
  ['factors_relevant', 'The clinical factors highlighted in the explanation were relevant to CKD review.'],
  ['direction_plausible', 'The displayed direction of the highlighted factors was clinically plausible.'],
  ['reasonableness', 'The explanation helped me evaluate whether the model output was reasonable for the case.'],
  ['easy_to_use', 'The prototype was easy to use.'],
  ['time_acceptable', 'The time required to review each case and its model output was acceptable.'],
  ['useful_context', 'The model explanations added useful clinical context to the model output.'],
  ['further_evaluation', 'I would support further evaluation of this system in a clinical setting.'],
] as const;

const SPECIALTIES = ['Nephrology', 'Urology', 'Internal Medicine', 'Family Medicine / General Practice', 'Endocrinology / Diabetology', 'Cardiology', 'Critical Care / Intensive Care', 'Geriatrics', 'Clinical Pharmacology', 'Other'];
const EMPTY_CONTACT: ContactDetails = { fullName: '', email: '', phone: '', findings: false, interview: false, paper: false };
const FIELD_GROUPS = [
  { key: 'renal', title: 'Renal measurements', description: 'Kidney function and urine albumin measurements' },
  { key: 'laboratory', title: 'Other laboratory measurements', description: 'Available non-renal laboratory results' },
  { key: 'vitals', title: 'Vital signs and anthropometrics', description: 'Available observations at or before index' },
  { key: 'demographics', title: 'Demographics and context', description: 'Background information available to the reviewer' },
] as const;

function fieldGroup(field: ClinicalField) {
  if (['DERIVED_EGFR_CKD_EPI_2021', 'CREATININE_FINAL_UMOL_L', 'UACR_FINAL_MG_MMOL', 'BUN_FINAL_MMOL_L'].includes(field.predictor)) return 'renal';
  if (['BMI_MODEL', 'DBP', 'PULSE_FINAL', 'RESPIRATION_FINAL', 'SBP', 'TEMPERATURE_FINAL'].includes(field.predictor)) return 'vitals';
  if (['AGE_AT_INDEX', 'GENDER', 'NATIONALITY_GROUP'].includes(field.predictor)) return 'demographics';
  return 'laboratory';
}

function displayedClinicalValue(predictor: string, rawValue: unknown) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return 'Not measured';
  const value = String(rawValue);
  if (predictor === 'AGE_AT_INDEX') {
    const numeric = Number.parseFloat(value);
    if (Number.isFinite(numeric)) return String(Math.round(numeric));
  }
  return value;
}

function bmiCategory(rawValue: string) {
  const bmi = Number.parseFloat(rawValue);
  if (!Number.isFinite(bmi)) return '';
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Healthy weight';
  if (bmi < 30) return 'Overweight';
  if (bmi < 35) return 'Obesity class I';
  if (bmi < 40) return 'Obesity class II';
  return 'Obesity class III';
}

function trajectoryTiming(points: TrajectoryPoint[]) {
  const earliest = points[0]?.relativeDay ?? 0;
  const latest = points.at(-1)?.relativeDay ?? 0;
  const span = Math.max(0, Math.round(latest - earliest));
  const latestText = Math.abs(latest) < 0.5 ? 'at index' : `${Math.abs(Math.round(latest))} days before index`;
  return { ticks: [earliest, 0], summary: `Observation span: ${span} days · Latest reading: ${latestText}` };
}

function firstValue(record: AnyRecord, keys: string[]) {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return String(record[key]);
  return '';
}

function factorUnit(predictor: string, name: string) {
  const key = `${predictor} ${name}`.toLowerCase();
  if (key.includes('egfr')) return 'mL/min/1.73 m²';
  if (key.includes('creatinine')) return 'µmol/L';
  if (key.includes('bun')) return 'mmol/L';
  if (key.includes('hemoglobin')) return 'g/L';
  if (key.includes('temperature')) return '°C';
  if (key.includes('respirat')) return 'breaths/min';
  if (key.includes('pulse')) return 'beats/min';
  if (key.includes('blood pressure')) return 'mmHg';
  if (key.includes('bmi')) return 'kg/m²';
  if (key.includes('age')) return 'years';
  if (key.includes('sodium') || key.includes('potassium')) return 'mmol/L';
  if (key.includes('wbc') || key.includes('lymphocyte') || key.includes('eosinophil')) return '×10⁹/L';
  if (key.includes('rdw')) return '%';
  return '';
}

function relativeScore(score?: string) {
  if (!score) return '—';
  const numeric = Number.parseFloat(score.replace('%', '').trim());
  if (!Number.isFinite(numeric)) return score;
  return `${Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(1)}/100`;
}

function findCases(input: unknown): AnyRecord[] {
  if (Array.isArray(input)) return input.filter((item): item is AnyRecord => Boolean(item && typeof item === 'object'));
  if (!input || typeof input !== 'object') return [];
  const object = input as AnyRecord;
  for (const key of ['cases', 'case_bundle', 'records', 'data']) {
    const found = findCases(object[key]);
    if (found.length) return found;
  }
  return [];
}

function normalizeBundle(input: unknown): ReviewCase[] {
  return findCases(input).map((record, index) => {
    const rawFields = record.clinical_data ?? record.clinical_fields ?? record.fields;
    const fields: ClinicalField[] = Array.isArray(rawFields) ? rawFields.map((item, fieldIndex) => {
      const row = item as AnyRecord;
      const rawValue = row.displayed_value ?? row.value;
      return {
        predictor: firstValue(row, ['predictor']),
        name: firstValue(row, ['clinical_field', 'display_name', 'name']) || `Field ${fieldIndex + 1}`,
        value: displayedClinicalValue(firstValue(row, ['predictor']), rawValue),
        timing: firstValue(row, ['measurement_timing']),
        distinctDates: firstValue(row, ['distinct_measurement_dates']),
        chronologyNote: firstValue(row, ['chronology_note']),
      };
    }) : [];
    const rawFactors = record.top_five_model_factors ?? record.shap_factors;
    const factors: Factor[] = Array.isArray(rawFactors) ? rawFactors.slice(0, 5).map((item, factorIndex) => {
      const row = item as AnyRecord;
      const predictor = firstValue(row, ['predictor']);
      const name = firstValue(row, ['clinical_factor', 'display_name', 'predictor']) || `Factor ${factorIndex + 1}`;
      return {
        predictor,
        name,
        value: displayedClinicalValue(predictor, firstValue(row, ['displayed_value', 'value'])),
        unit: factorUnit(predictor, name),
        direction: firstValue(row, ['direction']) || 'Model contribution',
        contribution: firstValue(row, ['raw_margin_contribution', 'shap_contribution']),
      };
    }) : [];
    const rawTrajectories = record.renal_trajectories ?? record.trajectories;
    const trajectories: Trajectory[] = Array.isArray(rawTrajectories) ? rawTrajectories.map((item) => {
      const row = item as AnyRecord;
      const rawPoints = Array.isArray(row.points) ? row.points : [];
      const points = rawPoints.map((point) => {
        const value = point as AnyRecord;
        return {
          relativeDay: Number(value.relative_day ?? value.relativeDay),
          value: Number(value.value),
        };
      }).filter((point) => Number.isFinite(point.relativeDay) && Number.isFinite(point.value)).sort((a, b) => a.relativeDay - b.relativeDay);
      return {
        predictor: firstValue(row, ['predictor']),
        name: firstValue(row, ['measurement_name', 'name']),
        unit: firstValue(row, ['unit']),
        points,
      };
    }).filter((item) => item.points.length >= 2) : [];
    return {
      caseCode: firstValue(record, CASE_KEYS) || `CASE_${String(index + 1).padStart(3, '0')}`,
      fields,
      score: firstValue(record, ['ckd_review_score', 'score']),
      tier: firstValue(record, ['review_tier', 'tier']),
      factors,
      trajectories,
    };
  });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(value); value = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else value += character;
  }
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeOrders(text: string): OrderRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const find = (names: string[]) => header.findIndex((cell) => names.some((name) => cell.includes(name)));
  const clinicianIndex = find(['clinician']);
  const phaseIndex = find(['phase']);
  const caseIndex = find(['case_code', 'case code', 'case']);
  const orderIndex = find(['order', 'position', 'sequence']);
  return rows.slice(1).map((row, index) => ({
    clinician: row[clinicianIndex]?.trim(),
    phase: (row[phaseIndex]?.toLowerCase().includes('b') ? 'Phase B' : 'Phase A') as Phase,
    caseCode: row[caseIndex]?.trim(),
    order: Number(row[orderIndex]) || index + 1,
  })).filter((item) => item.clinician && item.caseCode);
}

function csvEscape(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function downloadCsv(lines: string[], fileName: string) {
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function ChoiceGroup({ title, value, onChange, options }: { title: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <fieldset className="question-block"><legend>{title}</legend><RadioGroup value={value} onValueChange={onChange} className="choice-grid">{options.map((option) => { const id = `${title}-${option}`.replaceAll(' ', '-'); return <Label key={option} htmlFor={id} className="choice-card"><RadioGroupItem id={id} value={option} aria-label={`${title}: ${option}`} /><span>{option}</span></Label>; })}</RadioGroup></fieldset>;
}
function StudyMark({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? 'study-mark large' : 'study-mark'} aria-hidden="true">
      <img src="./assets/ckd-hidden-risk-ai-mark-v2-512.png" alt="" />
    </span>
  );
}
function Brand() { return <div className="brand-lockup"><StudyMark /><div><strong>CKD Hidden-Risk Clinician Review Study</strong><span>Exploratory clinical evaluation</span></div></div>; }
function StudyHeader({ step }: { step: number }) {
  const labels = ['Profile', 'Instructions', 'Review', 'Questionnaire', 'Optional contact'];
  return <header className="topbar intro-topbar"><Brand /><ol className="intro-steps">{labels.map((label, index) => <li className={index < step ? 'complete' : index === step ? 'active' : ''} key={label}><span>{index < step ? '✓' : index + 1}</span>{label}</li>)}</ol></header>;
}
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="select-field"><span>{label} <b>*</b></span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Select one</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}
function TextField({ label, value, onChange, required, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; placeholder?: string; type?: string }) {
  return <label className="select-field"><span>{label} {required ? <b>*</b> : <small>(optional)</small>}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
function SurveyText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span>{label} <small>(optional)</small></span><textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Type your response" /></label>;
}
function ContactChoice({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="contact-choice"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [phase, setPhase] = useState<Phase>('Phase A');
  const [position, setPosition] = useState(0);
  const [phaseACases, setPhaseACases] = useState<ReviewCase[]>([]);
  const [phaseBCases, setPhaseBCases] = useState<ReviewCase[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadingError, setLoadingError] = useState('');
  const [profile, setProfile] = useState<Profile>({ participantCode: '', specialty: '', experience: '', aiExperience: '', institution: '' });
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [form, setForm] = useState<Partial<Answer>>({});
  const [pilotFeedback, setPilotFeedback] = useState<Record<string, PilotFeedback>>({});
  const [postSurvey, setPostSurvey] = useState<Record<string, string>>({});
  const [contact, setContact] = useState<ContactDetails>(EMPTY_CONTACT);
  const [caseStartedAt, setCaseStartedAt] = useState(Date.now());
  const [submissionEndpoint, setSubmissionEndpoint] = useState('');
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus>('idle');
  const [submissionMessage, setSubmissionMessage] = useState('');

  const participantCode = profile.participantCode.trim().toUpperCase();
  const validParticipantCode = /^(CLINICIAN_0[1-5]|PILOT_REVIEWER_0[1-2])$/.test(participantCode);
  const isPilot = participantCode.startsWith('PILOT_REVIEWER_');
  const activeCases = phase === 'Phase A' ? phaseACases : phaseBCases;
  const order = useMemo(() => {
    const selected = orders.filter((row) => row.clinician === participantCode && row.phase === phase).sort((a, b) => a.order - b.order).map((row) => row.caseCode);
    return selected.length === 20 ? selected : activeCases.map((item) => item.caseCode);
  }, [activeCases, orders, participantCode, phase]);
  const current = activeCases.find((item) => item.caseCode === order[position]);
  const responseKey = current ? `${phase}|${current.caseCode}` : '';
  const currentPilot = current ? pilotFeedback[current.caseCode] ?? {} : {};
  const completedInPhase = order.filter((caseCode) => answers[`${phase}|${caseCode}`]).length;
  const totalProgress = phase === 'Phase A' ? completedInPhase : 20 + completedInPhase;
  const materialsReady = phaseACases.length === 20 && !loadingError;

  useEffect(() => {
    Promise.all([
      fetch('./data/pilot_v2_phase_a_case_bundle.json', { cache: 'no-store' }).then((response) => response.json()),
      fetch('./data/clinician_case_presentation_order.csv', { cache: 'no-store' }).then((response) => response.text()),
    ]).then(([bundle, orderText]) => {
      const cases = normalizeBundle(bundle);
      if (cases.length !== 20 || cases.some((item) => item.fields.length !== 23)) throw new Error('Invalid Phase-A materials');
      setPhaseACases(cases);
      setOrders(normalizeOrders(orderText));
    }).catch(() => setLoadingError('The study materials could not be loaded. Please contact the study administrator.'));
  }, []);

  useEffect(() => {
    fetch('./study-config.json', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((value: unknown) => { const config = value as AnyRecord; setSubmissionEndpoint(typeof config.googleAppsScriptUrl === 'string' ? config.googleAppsScriptUrl.trim() : ''); })
      .catch(() => setSubmissionEndpoint(''));
  }, []);

  useEffect(() => {
    if (!participantCode) return;
    const savedAnswers = localStorage.getItem(`ckd-study-${participantCode}-answers`);
    const savedPilot = localStorage.getItem(`ckd-study-${participantCode}-pilot`);
    const savedSurvey = localStorage.getItem(`ckd-study-${participantCode}-questionnaire`);
    if (savedAnswers) setAnswers(JSON.parse(savedAnswers));
    if (savedPilot) setPilotFeedback(JSON.parse(savedPilot));
    if (savedSurvey) setPostSurvey(JSON.parse(savedSurvey));
  }, [participantCode]);

  useEffect(() => {
    if (!responseKey) return;
    setForm(answers[responseKey] ?? {});
    setCaseStartedAt(Date.now());
  }, [answers, responseKey]);

  useEffect(() => {
    if (screen !== 'review') return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('case-review-start')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase, position, screen]);

  async function openPhaseB() {
    try {
      const response = await fetch('./data/pilot_v2_phase_b_case_bundle.json', { cache: 'no-store' });
      const bundle = await response.json();
      const cases = normalizeBundle(bundle);
      if (cases.length !== 20 || cases.some((item) => !item.score || item.factors?.length !== 5)) throw new Error('Invalid Phase-B bundle');
      const sameClinicalInformation = JSON.stringify(cases.map(({ caseCode, fields, trajectories }) => ({ caseCode, fields, trajectories }))) === JSON.stringify(phaseACases.map(({ caseCode, fields, trajectories }) => ({ caseCode, fields, trajectories })));
      if (!sameClinicalInformation) throw new Error('Phase mismatch');
      setPhaseBCases(cases);
      setPhase('Phase B');
      setPosition(0);
      setScreen('review');
    } catch { setLoadingError('Phase B could not be validated. Please contact the study administrator.'); }
  }

  function saveProfile() {
    if (!validParticipantCode || !profile.specialty || !profile.experience || !profile.aiExperience) return;
    const normalized = { ...profile, participantCode };
    setProfile(normalized);
    localStorage.setItem(`ckd-study-${participantCode}-profile`, JSON.stringify(normalized));
    setScreen('instructions');
  }

  function updatePilot(changes: Partial<PilotFeedback>) {
    if (!current) return;
    const updated = { ...pilotFeedback, [current.caseCode]: { ...currentPilot, ...changes } };
    setPilotFeedback(updated);
    localStorage.setItem(`ckd-study-${participantCode}-pilot`, JSON.stringify(updated));
  }

  function saveCase() {
    if (!current || !form.concern || !form.review || !form.sufficiency || !form.confidence) return;
    if (phase === 'Phase B' && (!form.usefulness || !form.clarity || !form.changed)) return;
    if (isPilot && phase === 'Phase A' && !currentPilot.phaseAAnswerable) return;
    if (isPilot && phase === 'Phase B' && !currentPilot.phaseBInterpretation) return;
    const answer: Answer = { ...form, savedAt: new Date().toISOString(), reviewTimeSeconds: Math.max(1, Math.round((Date.now() - caseStartedAt) / 1000)) } as Answer;
    const updated = { ...answers, [responseKey]: answer };
    setAnswers(updated);
    localStorage.setItem(`ckd-study-${participantCode}-answers`, JSON.stringify(updated));
    if (position < 19) { setPosition(position + 1); return; }
    if (phase === 'Phase A') setScreen('phase-transition');
    else setScreen('questionnaire');
  }

  function saveQuestionnaire() {
    if (POST_ITEMS.some(([key]) => !postSurvey[key])) return;
    const updated = { ...postSurvey, submitted_at: new Date().toISOString() };
    setPostSurvey(updated);
    localStorage.setItem(`ckd-study-${participantCode}-questionnaire`, JSON.stringify(updated));
    setScreen('contact');
  }
  function phasePresentationOrder(selectedPhase: Phase) {
    const selected = orders.filter((row) => row.clinician === participantCode && row.phase === selectedPhase).sort((a, b) => a.order - b.order).map((row) => row.caseCode);
    return selected.length === 20 ? selected : phaseACases.map((item) => item.caseCode);
  }

  function buildSubmission(finalContact: ContactDetails) {
    const submissionKey = `ckd-study-${participantCode}-submission-id`;
    const submissionId = localStorage.getItem(submissionKey) || crypto.randomUUID();
    localStorage.setItem(submissionKey, submissionId);
    const caseResponses = (['Phase A', 'Phase B'] as Phase[]).flatMap((selectedPhase) => phasePresentationOrder(selectedPhase).map((caseCode, index) => {
      const answer = answers[`${selectedPhase}|${caseCode}`];
      if (!answer) return null;
      return {
        phase: selectedPhase,
        caseCode,
        presentationOrder: index + 1,
        concern: answer.concern,
        additionalRenalReview: answer.review,
        informationSufficient: answer.sufficiency,
        decisionConfidence: answer.confidence,
        scoreUsefulness: answer.usefulness ?? '',
        shapClarity: answer.clarity ?? '',
        modelChangedRecommendation: answer.changed ?? '',
        rationale: answer.rationale ?? '',
        reviewTimeSeconds: answer.reviewTimeSeconds,
        savedAt: answer.savedAt,
      };
    }).filter(Boolean));
    const hasContact = Boolean(finalContact.fullName || finalContact.email || finalContact.phone || finalContact.findings || finalContact.interview || finalContact.paper);
    return {
      schemaVersion: 'pilot-v2-2026-09-06',
      submissionId,
      participantCode,
      profile: { specialty: profile.specialty, experienceGroup: profile.experience, aiExperience: profile.aiExperience, institution: profile.institution },
      caseResponses,
      questionnaire: {
        scoreClear: postSurvey.score_clear,
        shapClear: postSurvey.explanation_clear,
        directionClear: postSurvey.direction_clear,
        factorsRelevant: postSurvey.factors_relevant,
        directionPlausible: postSurvey.direction_plausible,
        reasonableness: postSurvey.reasonableness,
        easyToUse: postSurvey.easy_to_use,
        timeAcceptable: postSurvey.time_acceptable,
        usefulContext: postSurvey.useful_context,
        furtherEvaluation: postSurvey.further_evaluation,
        suggestedImprovement: postSurvey.suggested_improvement ?? '',
        additionalVariables: postSurvey.additional_variables ?? '',
        questionableOutput: postSurvey.questionable_output ?? '',
        submittedAt: postSurvey.submitted_at ?? new Date().toISOString(),
      },
      optionalContact: hasContact ? { ...finalContact, savedAt: new Date().toISOString() } : null,
      pilotChecklist: isPilot ? phaseACases.map((reviewCase) => ({ caseCode: reviewCase.caseCode, ...(pilotFeedback[reviewCase.caseCode] ?? {}) })) : [],
      completedAt: new Date().toISOString(),
    };
  }

  async function finishStudy(finalContact: ContactDetails) {
    setContact(finalContact);
    localStorage.setItem(`ckd-study-${participantCode}-contact`, JSON.stringify({ ...finalContact, saved_at: new Date().toISOString() }));
    setScreen('complete');
    if (!submissionEndpoint) {
      setSubmissionStatus('not-configured');
      setSubmissionMessage('Online submission is not configured yet. Download the response files below as a backup.');
      return;
    }
    setSubmissionStatus('submitting');
    setSubmissionMessage('Sending the completed study responses…');
    try {
      const response = await fetch(submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(buildSubmission(finalContact)),
        redirect: 'follow',
      });
      const text = await response.text();
      let result: AnyRecord = {};
      try { result = JSON.parse(text) as AnyRecord; } catch { result = {}; }
      if (!response.ok || (result.status && !['ok', 'duplicate'].includes(String(result.status)))) throw new Error(String(result.message || 'Submission failed'));
      setSubmissionStatus('submitted');
      setSubmissionMessage(result.status === 'duplicate' ? 'This completed submission was already received.' : 'The completed responses were received by the study response store.');
      localStorage.setItem(`ckd-study-${participantCode}-submitted`, new Date().toISOString());
    } catch {
      setSubmissionStatus('failed');
      setSubmissionMessage('The online submission could not be confirmed. Download the response files below and contact the study administrator.');
    }
  }

  function exportResponses() {
    const header = ['participant_code', 'specialty', 'experience_group', 'ai_experience', 'institution', 'phase', 'case_code', 'ckd_concern', 'additional_renal_review', 'information_sufficient', 'decision_confidence', 'score_usefulness', 'shap_clarity', 'model_changed_recommendation', 'free_text_rationale', 'review_time_seconds', 'saved_at'];
    const lines = [header.map(csvEscape).join(',')];
    for (const item of ['Phase A', 'Phase B'] as Phase[]) for (const reviewCase of phaseACases) {
      const answer = answers[`${item}|${reviewCase.caseCode}`];
      if (answer) lines.push([participantCode, profile.specialty, profile.experience, profile.aiExperience, profile.institution, item, reviewCase.caseCode, answer.concern, answer.review, answer.sufficiency, answer.confidence, answer.usefulness, answer.clarity, answer.changed, answer.rationale, answer.reviewTimeSeconds, answer.savedAt].map(csvEscape).join(','));
    }
    downloadCsv(lines, `${participantCode.toLowerCase()}_case_responses.csv`);
  }
  function exportQuestionnaire() {
    const lines = [['participant_code', 'item_code', 'response'].map(csvEscape).join(',')];
    POST_ITEMS.forEach(([key]) => lines.push([participantCode, key, postSurvey[key]].map(csvEscape).join(',')));
    ['suggested_improvement', 'additional_variables', 'questionable_output', 'submitted_at'].forEach((key) => lines.push([participantCode, key, postSurvey[key]].map(csvEscape).join(',')));
    downloadCsv(lines, `${participantCode.toLowerCase()}_questionnaire.csv`);
  }
  function exportContact() {
    const lines = [
      ['participant_code', 'full_name', 'email', 'phone_or_whatsapp', 'receive_findings', 'follow_up_interview', 'receive_paper'].map(csvEscape).join(','),
      [participantCode, contact.fullName, contact.email, contact.phone, contact.findings, contact.interview, contact.paper].map(csvEscape).join(','),
    ];
    downloadCsv(lines, `${participantCode.toLowerCase()}_optional_contact.csv`);
  }
  function exportPilotChecklist() {
    const lines = [['pilot_reviewer_code', 'case_code', 'phase_a_information_answerable', 'missing_information_needed', 'terminology_or_layout_unclear', 'phase_b_score_explanation_clear', 'technical_problem', 'overall_pilot_comment'].map(csvEscape).join(',')];
    phaseACases.forEach((reviewCase) => { const item = pilotFeedback[reviewCase.caseCode] ?? {}; lines.push([participantCode, reviewCase.caseCode, item.phaseAAnswerable, item.missingInformation, item.unclearTerminology, item.phaseBInterpretation, item.technicalProblem, item.overallComment].map(csvEscape).join(',')); });
    downloadCsv(lines, `${participantCode.toLowerCase()}_pilot_usability_checklist.csv`);
  }

  const ready = Boolean(form.concern && form.review && form.sufficiency && form.confidence && (phase === 'Phase A' || (form.usefulness && form.clarity && form.changed)) && (!isPilot || (phase === 'Phase A' ? currentPilot.phaseAAnswerable : currentPilot.phaseBInterpretation)));

  if (screen === 'welcome') return <Welcome ready={materialsReady} error={loadingError} onStart={() => setScreen('profile')} />;
  if (screen === 'profile') return <ProfileScreen profile={profile} participantCode={participantCode} validParticipantCode={validParticipantCode} onChange={setProfile} onBack={() => setScreen('welcome')} onContinue={saveProfile} />;
  if (screen === 'instructions') return <Instructions onBack={() => setScreen('profile')} onBegin={() => { setPhase('Phase A'); setPosition(0); setScreen('review'); }} />;
  if (screen === 'phase-transition') return <PhaseTransition error={loadingError} onContinue={openPhaseB} />;
  if (screen === 'questionnaire') return <Questionnaire values={postSurvey} onChange={setPostSurvey} onContinue={saveQuestionnaire} />;
  if (screen === 'contact') return <ContactScreen contact={contact} onChange={setContact} onSkip={() => void finishStudy(EMPTY_CONTACT)} onFinish={() => void finishStudy(contact)} />;
  if (screen === 'complete') return <Complete participantCode={participantCode} isPilot={isPilot} hasContact={Boolean(contact.fullName || contact.email || contact.phone || contact.findings || contact.interview || contact.paper)} submissionStatus={submissionStatus} submissionMessage={submissionMessage} onRetry={() => void finishStudy(contact)} onResponses={exportResponses} onQuestionnaire={exportQuestionnaire} onContact={exportContact} onPilot={exportPilotChecklist} />;
  if (!current) return <main className="intro-shell"><header className="topbar"><Brand /></header><section className="completion-panel"><CircleAlert /><h1>Case materials unavailable</h1><p>Please return to the study link or contact the study administrator.</p></section></main>;

  return <ReviewScreen phase={phase} position={position} totalProgress={totalProgress} participantCode={participantCode} isPilot={isPilot} current={current} form={form} pilot={currentPilot} ready={ready} onForm={setForm} onPilot={updatePilot} onSave={saveCase} />;
}

function Welcome({ ready, error, onStart }: { ready: boolean; error: string; onStart: () => void }) {
  return <main className="intro-shell"><header className="topbar"><Brand /><div className="privacy-note"><LockKeyhole /> Anonymous case review</div></header><section className="intro-panel welcome-panel"><StudyMark large /><p className="eyebrow">Welcome</p><h1>CKD Hidden-Risk Clinician Review Study</h1><p className="intro-lead">Thank you for participating in this exploratory evaluation.</p><Card className="intro-card"><CardContent><p>This study evaluates a clinical decision-support model designed to identify patients who may benefit from additional renal review. It produces a relative CKD-review ranking and does not diagnose CKD.</p><h2>The study consists of three parts</h2><ul className="check-list"><li><CheckCircle2 /> Review 20 anonymous cases twice: first without model output, then with the model score and explanation.</li><li><CheckCircle2 /> Record your independent clinical assessment in both phases.</li><li><CheckCircle2 /> Complete a short questionnaire about the model output and interface.</li></ul><div className="time-strip"><Clock3 /><span><strong>Estimated completion time:</strong> 35–45 minutes</span></div><div className="privacy-strip"><ShieldCheck /><span>Your progress is saved in this browser. Patient identifiers and observed CKD labels are not displayed.</span></div></CardContent></Card>{error && <div className="error-banner"><CircleAlert />{error}</div>}<Button className="intro-primary" disabled={!ready} onClick={onStart}>Start study <ArrowRight /></Button></section></main>;
}

function ProfileScreen({ profile, participantCode, validParticipantCode, onChange, onBack, onContinue }: { profile: Profile; participantCode: string; validParticipantCode: boolean; onChange: (profile: Profile) => void; onBack: () => void; onContinue: () => void }) {
  return <main className="intro-shell"><StudyHeader step={0} /><section className="intro-panel"><p className="eyebrow">Participant information</p><h1>Professional profile</h1><p className="intro-lead">These details support grouped analysis by specialty and experience. Use the anonymous participant code supplied by the study administrator.</p><Card className="intro-card"><CardContent className="profile-form"><div><TextField label="Participant code" required value={profile.participantCode} onChange={(value) => onChange({ ...profile, participantCode: value })} placeholder="e.g., CLINICIAN_01" />{participantCode && !validParticipantCode && <p className="profile-code-note">This code is not recognised. Please enter the code exactly as supplied by the study administrator.</p>}</div><SelectField label="Medical specialty" value={profile.specialty} onChange={(value) => onChange({ ...profile, specialty: value })} options={SPECIALTIES} /><SelectField label="Years of clinical experience" value={profile.experience} onChange={(value) => onChange({ ...profile, experience: value })} options={['Less than 5 years', '5–10 years', '11–20 years', 'More than 20 years']} /><SelectField label="Previous experience using clinical AI systems" value={profile.aiExperience} onChange={(value) => onChange({ ...profile, aiExperience: value })} options={['None', 'Beginner', 'Intermediate', 'Advanced']} /><TextField label="Institution" value={profile.institution} onChange={(value) => onChange({ ...profile, institution: value })} placeholder="Optional" /></CardContent></Card><div className="intro-actions"><Button variant="outline" onClick={onBack}><ArrowLeft /> Back</Button><Button disabled={!validParticipantCode || !profile.specialty || !profile.experience || !profile.aiExperience} onClick={onContinue}>Continue <ArrowRight /></Button></div></section></main>;
}

function Instructions({ onBack, onBegin }: { onBack: () => void; onBegin: () => void }) {
  return <main className="intro-shell"><StudyHeader step={1} /><section className="intro-panel"><p className="eyebrow">Before you begin</p><h1>Study instructions</h1><Card className="intro-card instructions-card"><CardContent><section><span className="instruction-number">1</span><div><h2>Phase A — clinician-only review</h2><p>Review all 20 cases using only the available clinical information. The model score, tier, SHAP factors, and case-level CKD documentation status remain hidden.</p></div></section><section><span className="instruction-number">2</span><div><h2>Phase B — model-assisted review</h2><p>After all Phase-A answers are submitted and locked, the same cases are shown with the CKD-review score, tier, and five leading model contributions. Case-level CKD documentation status remains hidden so your assessment of the model stays independent.</p></div></section><section><span className="instruction-number">3</span><div><h2>Complete independently</h2><p>Do not discuss cases with other clinicians until both phases are complete. “Not measured” means unavailable and does not mean normal.</p></div></section><section><span className="instruction-number">4</span><div><h2>Interpret relative timing carefully</h2><p>Dates are hidden. Measurements may be described as at index or a number of days before index. One abnormal value does not establish CKD chronicity.</p></div></section><div className="warning-panel"><CircleAlert /><div><strong>The model output does not independently establish or exclude CKD</strong><p>The relative score is calibrated to documented CKD; it is not the probability of verified disease. A low ranking may reflect missing information and does not rule out CKD. SHAP describes model behavior and is not causal.</p></div></div></CardContent></Card><div className="intro-actions"><Button variant="outline" onClick={onBack}><ArrowLeft /> Back</Button><Button onClick={onBegin}>Begin Phase A <ArrowRight /></Button></div></section></main>;
}

function PhaseTransition({ error, onContinue }: { error: string; onContinue: () => void }) {
  return <main className="intro-shell"><StudyHeader step={2} /><section className="completion-panel phase-complete"><span className="success-mark"><CheckCircle2 /></span><p className="eyebrow">Phase A complete</p><h1>Your clinician-only responses are locked</h1><p>The same 20 cases will now be shown with the CKD-review score, review tier, and five leading SHAP contributions. Your Phase-A answers cannot be changed, and case-level CKD documentation status will remain hidden.</p>{error && <div className="error-banner"><CircleAlert />{error}</div>}<Button onClick={onContinue}>Begin Phase B <ArrowRight /></Button></section></main>;
}

function Questionnaire({ values, onChange, onContinue }: { values: Record<string, string>; onChange: (values: Record<string, string>) => void; onContinue: () => void }) {
  return <main className="intro-shell"><StudyHeader step={3} /><section className="survey-panel"><p className="eyebrow">Post-review questionnaire</p><h1>Clinical XAI evaluation</h1><p className="intro-lead">Please rate each statement based on your experience reviewing the cases and corresponding model outputs.</p><div className="scale-key">1 = Strongly disagree · 2 = Disagree · 3 = Neutral · 4 = Agree · 5 = Strongly agree</div><Card className="intro-card survey-card"><CardContent>{POST_ITEMS.map(([key, item], index) => <div className="survey-item" key={key}><span>{index + 1}. {item}</span><RadioGroup value={values[key] ?? ''} onValueChange={(value) => onChange({ ...values, [key]: value })} className="survey-scale" aria-label={item}>{['1', '2', '3', '4', '5'].map((value) => <Label className="scale-choice" key={value} htmlFor={`${key}-${value}`}><RadioGroupItem id={`${key}-${value}`} value={value} aria-label={`${value}: ${['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'][Number(value) - 1]}`} /><span>{value}</span></Label>)}</RadioGroup></div>)}</CardContent></Card><Card className="intro-card survey-card"><CardHeader><CardTitle>Optional open feedback</CardTitle></CardHeader><CardContent className="open-feedback"><SurveyText label="What is the most important improvement you would suggest?" value={values.suggested_improvement ?? ''} onChange={(value) => onChange({ ...values, suggested_improvement: value })} /><SurveyText label="Are there additional clinical variables or patient information that should be considered?" value={values.additional_variables ?? ''} onChange={(value) => onChange({ ...values, additional_variables: value })} /><SurveyText label="Did you encounter a clinically questionable model output or explanation? Please describe it." value={values.questionable_output ?? ''} onChange={(value) => onChange({ ...values, questionable_output: value })} /></CardContent></Card><div className="questionnaire-note"><ShieldCheck /> Questionnaire responses are stored under your anonymous participant code.</div><div className="intro-actions"><Button disabled={POST_ITEMS.some(([key]) => !values[key])} onClick={onContinue}>Continue <ArrowRight /></Button></div></section></main>;
}

function ContactScreen({ contact, onChange, onSkip, onFinish }: { contact: ContactDetails; onChange: (contact: ContactDetails) => void; onSkip: () => void; onFinish: () => void }) {
  return <main className="intro-shell"><StudyHeader step={4} /><section className="survey-panel contact-panel"><p className="eyebrow">Optional</p><h1>Stay in the loop</h1><p className="intro-lead">You may provide contact details if you would like study updates or a follow-up invitation. Contact fields are excluded from the case-rating and questionnaire analysis exports.</p><Card className="intro-card"><CardContent className="contact-form"><div className="privacy-strip"><ShieldCheck /><span>Providing contact information is optional. Leave this page blank and select “Skip and finish” if you prefer not to share it.</span></div><TextField label="Full name" value={contact.fullName} onChange={(value) => onChange({ ...contact, fullName: value })} /><TextField label="Email address" type="email" value={contact.email} onChange={(value) => onChange({ ...contact, email: value })} /><TextField label="Phone / WhatsApp number" type="tel" value={contact.phone} onChange={(value) => onChange({ ...contact, phone: value })} /><fieldset className="contact-options"><legend>What would you like to receive? <small>(optional)</small></legend><ContactChoice label="A summary of the study findings when available" checked={contact.findings} onChange={(checked) => onChange({ ...contact, findings: checked })} /><ContactChoice label="An invitation to a brief follow-up interview" checked={contact.interview} onChange={(checked) => onChange({ ...contact, interview: checked })} /><ContactChoice label="A copy of the final thesis / research paper" checked={contact.paper} onChange={(checked) => onChange({ ...contact, paper: checked })} /></fieldset></CardContent></Card><div className="contact-actions"><Button variant="outline" onClick={onSkip}>Skip and finish</Button><Button onClick={onFinish}><CheckCircle2 /> Save and finish</Button></div></section></main>;
}

function Complete({ participantCode, isPilot, hasContact, submissionStatus, submissionMessage, onRetry, onResponses, onQuestionnaire, onContact, onPilot }: { participantCode: string; isPilot: boolean; hasContact: boolean; submissionStatus: SubmissionStatus; submissionMessage: string; onRetry: () => void; onResponses: () => void; onQuestionnaire: () => void; onContact: () => void; onPilot: () => void }) {
  const submitted = submissionStatus === 'submitted';
  const backupNeeded = submissionStatus === 'failed' || submissionStatus === 'not-configured';
  return <main className="intro-shell"><section className="completion-panel"><span className={submitted ? 'success-mark' : 'success-mark pending'}>{submitted ? <CheckCircle2 /> : <ShieldCheck />}</span><p className="eyebrow">Complete</p><h1>Thank you for participating in this study.</h1><p>{submitted ? 'Your responses have been successfully submitted.' : `Your responses are saved in this browser. ${submissionMessage}`}</p><div className={`submission-status ${submissionStatus}`}><span>{submissionStatus === 'submitting' ? 'Submitting…' : submitted ? 'Online submission confirmed' : submissionStatus === 'failed' ? 'Online submission needs attention' : 'Submission backup required'}</span>{submissionStatus === 'failed' && <Button variant="outline" onClick={onRetry}>Try online submission again</Button>}</div>{backupNeeded && <><p className="backup-explanation">The study response store could not confirm receipt. Download these files only as a temporary backup and send them to the study administrator.</p><div className="completion-actions"><Button onClick={onResponses}><Download /> Case responses</Button><Button variant="outline" onClick={onQuestionnaire}><Download /> Questionnaire</Button>{hasContact && <Button variant="outline" onClick={onContact}><Download /> Optional contact</Button>}{isPilot && <Button variant="outline" onClick={onPilot}><Download /> Pilot checklist</Button>}</div></>}<p className="completion-note">Participant code: {participantCode} · No patient identifiers or observed CKD labels were displayed.</p></section></main>;
}

function ReviewScreen({ phase, position, totalProgress, participantCode, isPilot, current, form, pilot, ready, onForm, onPilot, onSave }: { phase: Phase; position: number; totalProgress: number; participantCode: string; isPilot: boolean; current: ReviewCase; form: Partial<Answer>; pilot: PilotFeedback; ready: boolean; onForm: (form: Partial<Answer>) => void; onPilot: (changes: Partial<PilotFeedback>) => void; onSave: () => void }) {
  return <main className="app-shell"><header className="topbar"><Brand /><div className="privacy-note"><LockKeyhole /> {isPilot ? 'Pilot usability session' : 'Independent clinician review'}</div></header><div className="workspace"><aside className="study-rail"><div><p className="eyebrow">Review progress</p><h2>{phase}</h2><p className="rail-copy">{phase === 'Phase A' ? 'Clinical information only' : 'Model-assisted review'}</p></div><div className="progress-block"><div><span>Case {position + 1} of 20</span><strong>{Math.round((totalProgress / 40) * 100)}%</strong></div><Progress value={(totalProgress / 40) * 100} /></div><ol className="phase-list"><li className={phase === 'Phase A' ? 'active' : 'done'}><span>{phase === 'Phase A' ? '1' : '✓'}</span><div><strong>Phase A</strong><small>Model hidden</small></div></li><li className={phase === 'Phase B' ? 'active' : ''}><span>2</span><div><strong>Phase B</strong><small>Model revealed</small></div></li><li><span>3</span><div><strong>Questionnaire</strong><small>Overall evaluation</small></div></li></ol><div className="rail-safety"><CircleAlert /><p><strong>Not measured</strong> means unavailable. It does not mean normal.</p></div></aside><section className="review-column"><div className="case-heading" id="case-review-start"><div><p className="eyebrow">Anonymous case · {participantCode}</p><h1>Case {String(position + 1).padStart(2, '0')}</h1></div><Badge variant="secondary"><Activity /> {phase === 'Phase A' ? 'Model output hidden' : 'Model output revealed'}</Badge></div>{phase === 'Phase B' && <Card className="score-card"><CardContent><div className="score-value"><span>Relative review score</span><strong>{relativeScore(current.score)}</strong><Badge className="score-tier">{current.tier}</Badge></div><div className="score-copy"><strong>The model output supports review prioritization; it does not independently establish or exclude CKD.</strong><span>A relative model ranking calibrated to documented CKD—not the probability of verified disease.</span><span>A low score may reflect missing information and does not rule out CKD.</span></div></CardContent></Card>}<ClinicalCard caseKey={`${phase}-${current.caseCode}`} fields={current.fields} trajectories={current.trajectories} />{phase === 'Phase B' && <ExplanationCard factors={current.factors ?? []} />}<AssessmentCard phase={phase} form={form} onForm={onForm} />{isPilot && <PilotCard phase={phase} pilot={pilot} onPilot={onPilot} />}<div className="form-footer standalone"><div><CheckCircle2 /><span>{phase === 'Phase A' ? 'Submitted Phase-A answers are locked before Phase B opens.' : 'Case-level CKD documentation remains hidden to preserve independent model evaluation.'}</span></div><Button disabled={!ready} onClick={onSave}>{position === 19 ? (phase === 'Phase A' ? 'Complete and lock Phase A' : 'Complete Phase B') : 'Save and continue'} <ArrowRight /></Button></div></section></div></main>;
}

function ClinicalCard({ caseKey, fields, trajectories }: { caseKey: string; fields: ClinicalField[]; trajectories: Trajectory[] }) {
  const grouped = FIELD_GROUPS.map((group) => ({ ...group, fields: fields.filter((field) => fieldGroup(field) === group.key) }));
  return <Card className="clinical-card"><CardHeader><CardTitle>Available clinical information</CardTitle></CardHeader><CardContent>{trajectories.length > 0 && <RenalTrajectories trajectories={trajectories} />}<div className="clinical-groups">{grouped.map((group) => <ClinicalGroup key={`${caseKey}-${group.key}`} initiallyOpen={group.key === 'renal'} title={group.title} description={group.description} fields={group.fields} />)}</div><p className="timing-note">Relative timing is shown without direct dates. One measurement does not establish chronicity.</p></CardContent></Card>;
}

function ClinicalGroup({ initiallyOpen, title, description, fields }: { initiallyOpen: boolean; title: string; description: string; fields: ClinicalField[] }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <details className="clinical-group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary><div><strong>{title}</strong><span>{description}</span></div><b>{fields.length} fields</b></summary><div className="clinical-grid">{fields.map(({ predictor, name, value, timing, distinctDates, chronologyNote }) => { const bmiLabel = predictor === 'BMI_MODEL' ? bmiCategory(value) : ''; return <div className={value.toLowerCase().includes('not measured') ? 'clinical-field missing' : 'clinical-field'} key={predictor || name}><span>{name}</span><div className="clinical-value"><strong>{value}</strong>{bmiLabel && <small className="bmi-category">{bmiLabel}</small>}{timing && <small>{timing}{distinctDates ? ` · ${distinctDates} measurement date${distinctDates === '1' ? '' : 's'}` : ''}</small>}{chronologyNote && <em>{chronologyNote}</em>}</div></div>; })}</div></details>;
}

function RenalTrajectories({ trajectories }: { trajectories: Trajectory[] }) {
  return <section className="trajectory-section" aria-label="Renal measurement trajectories"><div className="trajectory-heading"><div><p className="eyebrow">Repeated renal measurements</p><h3>Measurement trajectories</h3></div><span>Earlier → Index</span></div><div className="trajectory-grid">{trajectories.map((trajectory) => { const timing = trajectoryTiming(trajectory.points); return <article className="trajectory-panel" key={trajectory.predictor}><div className="trajectory-title"><strong>{trajectory.name}</strong><span>{trajectory.points.length} measurements · {trajectory.unit}</span></div><div className="trajectory-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={trajectory.points} margin={{ top: 12, right: 20, left: 0, bottom: 2 }}><CartesianGrid stroke="#e3e9ed" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="relativeDay" type="number" domain={['dataMin', 0]} ticks={timing.ticks} tickFormatter={(value) => Math.abs(Number(value)) < 0.5 ? 'Index' : 'Earlier'} interval={0} height={30} tick={{ fill: '#526879', fontSize: 11 }} axisLine={{ stroke: '#cbd6dc' }} tickLine={false} /><YAxis width={42} domain={['auto', 'auto']} tick={{ fill: '#667889', fontSize: 11 }} axisLine={false} tickLine={false} /><ReferenceLine x={0} stroke="#aab6bf" strokeDasharray="3 4" />{trajectory.predictor === 'DERIVED_EGFR_CKD_EPI_2021' && <ReferenceLine y={60} stroke="#8a98a4" strokeDasharray="4 4" label={{ value: 'eGFR 60', fill: '#6d7d8d', fontSize: 10, position: 'insideTopLeft' }} />}<Tooltip labelFormatter={(value) => Math.abs(Number(value)) < 0.5 ? 'Index encounter' : `${Math.abs(Math.round(Number(value)))} days before index`} formatter={(value) => [`${value} ${trajectory.unit}`, trajectory.name]} contentStyle={{ borderRadius: 10, borderColor: '#ced9df', fontSize: 12 }} /><Line type="linear" dataKey="value" stroke="#287681" strokeWidth={2.5} dot={{ r: 4, fill: '#fff', stroke: '#287681', strokeWidth: 2 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div><p className="trajectory-summary">{timing.summary}</p></article>; })}</div><p className="trajectory-note">Only observed measurements are shown; no values were imputed or smoothed. Hover over a point for its relative timing. Connecting lines are visual guides and do not establish CKD chronicity.</p></section>;
}
function ExplanationCard({ factors }: { factors: Factor[] }) {
  const magnitudes = factors.map((factor) => Math.abs(Number(factor.contribution))).filter(Number.isFinite);
  const maximum = Math.max(...magnitudes, 1);
  return <Card className="explanation-card"><CardHeader><p className="eyebrow">Model behavior</p><CardTitle>Five strongest influences for this case</CardTitle></CardHeader><CardContent><div className="factor-key"><span><i className="higher" /> Increased review priority</span><span><i className="lower" /> Decreased review priority</span></div><div className="factor-list">{factors.map((factor, index) => { const higher = factor.direction.toLowerCase().includes('higher'); const magnitude = Math.abs(Number(factor.contribution)); const strength = Number.isFinite(magnitude) ? Math.max(8, (magnitude / maximum) * 100) : 8; const bmiLabel = factor.predictor === 'BMI_MODEL' ? bmiCategory(factor.value) : ''; return <div className="factor-row" key={`${factor.name}-${index}`}><span className={higher ? 'factor-icon higher' : 'factor-icon lower'}>{higher ? <ArrowUpRight /> : <ArrowDownRight />}</span><div className="factor-content"><div className="factor-heading"><strong>{factor.name}</strong><small>{factor.value}{factor.unit ? ` ${factor.unit}` : ''}{bmiLabel ? ` · ${bmiLabel}` : ''}</small></div><span className={higher ? 'direction higher' : 'direction lower'}>{higher ? 'Increased the model’s review priority' : 'Decreased the model’s review priority'}</span><div className="factor-track" aria-label={`Relative influence ${Math.round(strength)}%`}><span className={higher ? 'higher' : 'lower'} style={{ width: `${strength}%` }} /></div></div></div>; })}</div><p className="factor-scale-note">Longer bars indicate stronger influence within this case only.</p><p className="shap-note">These factors explain the model’s behavior for this case. They do not indicate causality or establish a CKD diagnosis.</p><details className="technical-details"><summary>Technical details</summary><p>Raw SHAP contributions describe the ensemble mean raw margin (log-odds scale), not percentage points. They should not be compared as absolute clinical effect sizes.</p><ul>{factors.map((factor, index) => <li key={`${factor.name}-technical-${index}`}><span>{factor.name}</span><b>{factor.contribution ? Number(factor.contribution).toFixed(3) : 'Not available'}</b></li>)}</ul></details></CardContent></Card>;
}
function AssessmentCard({ phase, form, onForm }: { phase: Phase; form: Partial<Answer>; onForm: (form: Partial<Answer>) => void }) {
  return <Card className="assessment-card"><CardHeader><p className="eyebrow">Independent assessment</p><CardTitle>{phase === 'Phase A' ? 'Record your unaided clinical judgment' : 'Record your model-assisted judgment'}</CardTitle></CardHeader><CardContent className="question-stack"><ChoiceGroup title="How concerned are you about possible CKD?" value={form.concern ?? ''} onChange={(value) => onForm({ ...form, concern: value })} options={['None', 'Low', 'Moderate', 'High']} /><ChoiceGroup title="Would you recommend additional renal review?" value={form.review ?? ''} onChange={(value) => onForm({ ...form, review: value })} options={['Yes', 'No']} /><p className="question-help">Additional renal review may include chart review, repeat or additional renal testing, or nephrology referral.</p><ChoiceGroup title="Considering both the information shown and any important information not shown, is there enough information to make this assessment?" value={form.sufficiency ?? ''} onChange={(value) => onForm({ ...form, sufficiency: value })} options={['Yes', 'Partly', 'No']} /><p className="question-help">Choose “Partly” or “No” if a missing measurement, insufficient longitudinal follow-up, or an important clinical variable not displayed would affect your judgment.</p><ChoiceGroup title="How confident are you in this assessment?" value={form.confidence ?? ''} onChange={(value) => onForm({ ...form, confidence: value })} options={['1', '2', '3', '4', '5']} />{phase === 'Phase B' && <><ChoiceGroup title="How useful was the CKD-review score?" value={form.usefulness ?? ''} onChange={(value) => onForm({ ...form, usefulness: value })} options={['1', '2', '3', '4', '5']} /><ChoiceGroup title="How clear was the SHAP explanation?" value={form.clarity ?? ''} onChange={(value) => onForm({ ...form, clarity: value })} options={['1', '2', '3', '4', '5']} /><ChoiceGroup title="Did the model output change your recommendation?" value={form.changed ?? ''} onChange={(value) => onForm({ ...form, changed: value })} options={['Yes', 'No']} /><label className="text-question"><span>Optional rationale or concern</span><textarea value={form.rationale ?? ''} onChange={(event) => onForm({ ...form, rationale: event.target.value })} rows={4} placeholder="Optional free-text response" /></label></>}</CardContent></Card>;
}
function PilotCard({ phase, pilot, onPilot }: { phase: Phase; pilot: PilotFeedback; onPilot: (changes: Partial<PilotFeedback>) => void }) {
  return <Card className="pilot-card"><CardHeader><p className="eyebrow">Pilot usability check</p><CardTitle>{phase === 'Phase A' ? 'Can this case be reviewed as presented?' : 'Is the model-assisted display understandable?'}</CardTitle></CardHeader><CardContent className="question-stack">{phase === 'Phase A' ? <><ChoiceGroup title="Was the Phase-A information answerable?" value={pilot.phaseAAnswerable ?? ''} onChange={(value) => onPilot({ phaseAAnswerable: value })} options={['Yes', 'Partly', 'No']} /><SurveyText label="What information was missing or needed?" value={pilot.missingInformation ?? ''} onChange={(value) => onPilot({ missingInformation: value })} /><SurveyText label="Was any terminology or layout unclear?" value={pilot.unclearTerminology ?? ''} onChange={(value) => onPilot({ unclearTerminology: value })} /><SurveyText label="Did you encounter a technical problem?" value={pilot.technicalProblem ?? ''} onChange={(value) => onPilot({ technicalProblem: value })} /></> : <><ChoiceGroup title="Was the Phase-B score and explanation clear?" value={pilot.phaseBInterpretation ?? ''} onChange={(value) => onPilot({ phaseBInterpretation: value })} options={['Yes', 'Partly', 'No']} /><SurveyText label="Overall pilot comment for this case" value={pilot.overallComment ?? ''} onChange={(value) => onPilot({ overallComment: value })} /></>}</CardContent></Card>;
}
