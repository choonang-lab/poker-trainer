// Compile-time proof that engine.ts implements contract.ts EXACTLY.
// Type-checked by `tsc --noEmit`; never executed at runtime (no test imports it).
// Each line fails to compile if an engine export drifts from its declared
// signature in contract.ts — this is the enforcement Option A buys.
import type * as C from "./contract.ts";
import {
  card, rankOf, suitOf, score5, score7, cmpScore,
  equity, equityVsRange, outs,
  breakEven, callEV, regret, decisionRegret, estimateError, withinBand, brier,
  NO_ABSTRACTION,
  equityLeaf, fieldEquity, bestResponseEV, bestAction,
  ABSTRACTION_LIMITS, validateAbstraction, buildTree, truth, realizationFactor,
  actionEVs, grade,
  resultQuality, newReview, scheduleReview, dueReviews, nextReview,
  newSession, nextDrill, gradeDrill, classifyLeak, serializeSession, loadSession,
  calibration, leakReport,
} from "./engine.ts";
import { MODULES, moduleDone, moduleStatus, currentStreak } from "./curriculum.ts";

// L1
const _card: typeof C.card = card;
const _rankOf: typeof C.rankOf = rankOf;
const _suitOf: typeof C.suitOf = suitOf;
const _score5: typeof C.score5 = score5;
const _score7: typeof C.score7 = score7;
const _cmpScore: typeof C.cmpScore = cmpScore;
// L2
const _equity: typeof C.equity = equity;
const _equityVsRange: typeof C.equityVsRange = equityVsRange;
const _outs: typeof C.outs = outs;
// L4
const _breakEven: typeof C.breakEven = breakEven;
const _callEV: typeof C.callEV = callEV;
const _regret: typeof C.regret = regret;
const _decisionRegret: typeof C.decisionRegret = decisionRegret;
const _estimateError: typeof C.estimateError = estimateError;
const _withinBand: typeof C.withinBand = withinBand;
const _brier: typeof C.brier = brier;
// L3
const _NO_ABSTRACTION: typeof C.NO_ABSTRACTION = NO_ABSTRACTION;
const _equityLeaf: typeof C.equityLeaf = equityLeaf;
const _fieldEquity: typeof C.fieldEquity = fieldEquity;
const _bestResponseEV: typeof C.bestResponseEV = bestResponseEV;
const _bestAction: typeof C.bestAction = bestAction;
const _ABSTRACTION_LIMITS: typeof C.ABSTRACTION_LIMITS = ABSTRACTION_LIMITS;
const _validateAbstraction: typeof C.validateAbstraction = validateAbstraction;
const _buildTree: typeof C.buildTree = buildTree;
const _truth: typeof C.truth = truth;
const _realizationFactor: typeof C.realizationFactor = realizationFactor;
const _actionEVs: typeof C.actionEVs = actionEVs;
const _grade: typeof C.grade = grade;
const _resultQuality: typeof C.resultQuality = resultQuality;
const _newReview: typeof C.newReview = newReview;
const _scheduleReview: typeof C.scheduleReview = scheduleReview;
const _dueReviews: typeof C.dueReviews = dueReviews;
const _nextReview: typeof C.nextReview = nextReview;
const _newSession: typeof C.newSession = newSession;
const _nextDrill: typeof C.nextDrill = nextDrill;
const _gradeDrill: typeof C.gradeDrill = gradeDrill;
const _classifyLeak: typeof C.classifyLeak = classifyLeak;
const _serializeSession: typeof C.serializeSession = serializeSession;
const _loadSession: typeof C.loadSession = loadSession;
const _calibration: typeof C.calibration = calibration;
const _leakReport: typeof C.leakReport = leakReport;
const _MODULES: typeof C.MODULES = MODULES;
const _moduleDone: typeof C.moduleDone = moduleDone;
const _moduleStatus: typeof C.moduleStatus = moduleStatus;
const _currentStreak: typeof C.currentStreak = currentStreak;

void [
  _card, _rankOf, _suitOf, _score5, _score7, _cmpScore,
  _equity, _equityVsRange, _outs,
  _breakEven, _callEV, _regret, _decisionRegret, _estimateError, _withinBand, _brier,
  _NO_ABSTRACTION, _equityLeaf, _fieldEquity, _bestResponseEV, _bestAction,
  _ABSTRACTION_LIMITS, _validateAbstraction, _buildTree, _truth, _realizationFactor,
  _actionEVs, _grade,
  _resultQuality, _newReview, _scheduleReview, _dueReviews, _nextReview,
  _newSession, _nextDrill, _gradeDrill, _classifyLeak, _serializeSession, _loadSession,
  _calibration, _leakReport,
  _MODULES, _moduleDone, _moduleStatus, _currentStreak,
];
