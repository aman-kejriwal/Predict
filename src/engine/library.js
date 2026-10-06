// Built-in forecasting models. These let Oracle work fully offline, and they
// double as worked examples of the model format Claude is asked to produce.
//
// Evidence is in natural-log likelihood-ratio units:
//   ±0.2 weak, ±0.5 moderate, ±1.0 strong, ±2.0 near-decisive.
// `prior` on an option is how common that answer is (used to pick the next
// question and to simulate unanswered ones).
//
// Base rates are rough reference-class figures, stated in baseRateNote so the
// user can see — and disagree with — where the starting point comes from.

const yesNo = (yes, no, priorYes = 1, priorNo = 1) => [
  { label: 'Yes', logLR: yes, prior: priorYes },
  { label: 'No', logLR: no, prior: priorNo },
];

export const LIBRARY = [
  {
    id: 'wealth',
    title: 'Will I become rich?',
    keywords: ['rich', 'wealthy', 'wealth', 'millionaire', 'money', 'net worth', 'financially free', 'financial freedom', 'retire early', 'billionaire', 'crore', 'fortune'],
    question: 'Will I become rich in the future?',
    outcome: 'Reach a net worth in the top ~5% for your country (roughly US$1M+ in the US, or the local equivalent), in today’s money.',
    horizon: 'Within your working life (by age ~60)',
    domain: 'finance',
    baseRate: 0.07,
    baseRateNote: 'Roughly 5–9% of households in wealthy countries reach this level by retirement age; most get there through decades of saving and investing, not windfalls.',
    dependence: 0.25,
    caveat: 'Markets, health and luck matter a lot. This estimates odds, not destiny.',
    factors: [
      {
        id: 'age', label: 'Time horizon', type: 'choice', controllable: false,
        question: 'How old are you?',
        why: 'Compounding needs time. Every decade of runway roughly doubles what disciplined investing can produce.',
        options: [
          { label: 'Under 25', logLR: 0.6, prior: 2 },
          { label: '25–34', logLR: 0.35, prior: 2 },
          { label: '35–44', logLR: 0, prior: 2 },
          { label: '45–54', logLR: -0.4, prior: 1.5 },
          { label: '55+', logLR: -0.9, prior: 1.5 },
        ],
      },
      {
        id: 'income', label: 'Income level', type: 'scale', controllable: true,
        question: 'Compared to people your age in your country, where does your income sit?',
        why: 'Income is the raw material of wealth. Top-quintile earners are several times more likely to reach top-5% net worth.',
        options: [
          { label: 'Bottom 40%', logLR: -1.0, prior: 4 },
          { label: 'Middle 40–60%', logLR: -0.3, prior: 2 },
          { label: 'Upper 60–80%', logLR: 0.3, prior: 2 },
          { label: 'Top 20%', logLR: 0.9, prior: 1.5 },
          { label: 'Top 5%', logLR: 1.6, prior: 0.5 },
        ],
      },
      {
        id: 'savings_rate', label: 'Savings rate', type: 'scale', controllable: true,
        question: 'Roughly what share of your take-home pay do you save or invest each month?',
        why: 'Savings rate predicts wealth more strongly than income does: high earners who spend everything rarely get rich.',
        options: [
          { label: 'Nothing / I’m in the red', logLR: -1.3, prior: 3 },
          { label: 'Under 10%', logLR: -0.4, prior: 3 },
          { label: '10–20%', logLR: 0.3, prior: 2 },
          { label: '20–40%', logLR: 0.9, prior: 1 },
          { label: 'Over 40%', logLR: 1.4, prior: 0.4 },
        ],
      },
      {
        id: 'investing', label: 'Investing habit', type: 'choice', controllable: true,
        question: 'Where does your saved money mostly go?',
        why: 'Cash loses to inflation. Wealth is built by owning assets that compound: index funds, businesses, property.',
        options: [
          { label: 'Bank account / cash', logLR: -0.6, prior: 3 },
          { label: 'Mix of cash and some investments', logLR: 0.1, prior: 2 },
          { label: 'Mostly diversified investments (index funds, retirement accounts)', logLR: 0.7, prior: 1.5 },
          { label: 'Mostly speculation (crypto, options, stock tips)', logLR: -0.2, prior: 1 },
          { label: 'I don’t have savings yet', logLR: -0.8, prior: 2 },
        ],
      },
      {
        id: 'business', label: 'Ownership / equity', type: 'choice', controllable: true,
        question: 'Do you own a business or hold meaningful equity in a company?',
        why: 'A large share of top-1% wealth is business ownership. Equity gives uncapped upside that salaries do not.',
        options: [
          { label: 'No', logLR: -0.15, prior: 6 },
          { label: 'Side business or small stake', logLR: 0.3, prior: 2 },
          { label: 'Yes — I run a profitable business', logLR: 1.0, prior: 0.7 },
          { label: 'Yes — startup/company equity with real value', logLR: 0.8, prior: 0.5 },
        ],
      },
      {
        id: 'business_growth', label: 'Business trajectory', type: 'scale', controllable: true,
        askIf: { factorId: 'business', optionIndexes: [1, 2, 3] },
        question: 'How has that business or stake grown over the last two years?',
        why: 'Growth rate tells us whether ownership is a lottery ticket or a compounding engine.',
        options: [
          { label: 'Shrinking or losing money', logLR: -0.5, prior: 1 },
          { label: 'Flat', logLR: -0.1, prior: 1.5 },
          { label: 'Growing steadily', logLR: 0.5, prior: 1.5 },
          { label: 'Growing fast (>50%/yr)', logLR: 0.9, prior: 0.5 },
        ],
      },
      {
        id: 'debt', label: 'Debt load', type: 'choice', controllable: true,
        question: 'What best describes your debt (excluding a mortgage)?',
        why: 'High-interest debt is negative compounding — it works against you as hard as investing works for you.',
        options: [
          { label: 'No debt', logLR: 0.3, prior: 2 },
          { label: 'Low-interest only (student loan, car)', logLR: 0, prior: 3 },
          { label: 'Some credit card / personal loan debt', logLR: -0.5, prior: 2 },
          { label: 'Heavy high-interest debt', logLR: -1.1, prior: 1 },
        ],
      },
      {
        id: 'skills', label: 'Earning trajectory', type: 'scale', controllable: true,
        question: 'How valuable and in-demand are your skills, and is your earning power rising?',
        why: 'Future income matters more than today’s. Scarce, compounding skills (tech, medicine, sales, law, trades with leverage) raise the ceiling.',
        options: [
          { label: 'Low demand, flat or falling', logLR: -0.6, prior: 1.5 },
          { label: 'Average demand, slow growth', logLR: -0.1, prior: 3 },
          { label: 'In demand, steadily rising', logLR: 0.4, prior: 2 },
          { label: 'Rare, high-leverage skills, rising fast', logLR: 0.9, prior: 0.7 },
        ],
      },
      {
        id: 'literacy', label: 'Financial literacy', type: 'scale', controllable: true,
        question: 'How well do you understand compounding, fees, taxes and diversification?',
        why: 'Financially literate people avoid the expensive mistakes (fees, panic selling, scams) that quietly destroy wealth.',
        options: [
          { label: 'Barely', logLR: -0.4, prior: 2 },
          { label: 'Basics', logLR: 0, prior: 3 },
          { label: 'Solid — I could explain it to a friend', logLR: 0.35, prior: 2 },
          { label: 'Expert', logLR: 0.5, prior: 0.5 },
        ],
      },
      {
        id: 'discipline', label: 'Spending discipline', type: 'scale', controllable: true,
        question: 'When your income rises, what usually happens to your spending?',
        why: 'Lifestyle inflation is the #1 reason high earners stay broke.',
        options: [
          { label: 'It rises just as fast (or faster)', logLR: -0.6, prior: 3 },
          { label: 'It rises somewhat', logLR: 0, prior: 3 },
          { label: 'I bank most raises', logLR: 0.6, prior: 1 },
        ],
      },
      {
        id: 'family', label: 'Family head start', type: 'choice', controllable: false,
        question: 'Do you expect meaningful family support or inheritance?',
        why: 'Inheritance and family help with education or a first home are a major (if unfair) wealth predictor.',
        options: [
          { label: 'No — I support my family instead', logLR: -0.4, prior: 2 },
          { label: 'No', logLR: -0.1, prior: 4 },
          { label: 'Some help', logLR: 0.3, prior: 2 },
          { label: 'Substantial', logLR: 1.0, prior: 0.5 },
        ],
      },
      {
        id: 'location', label: 'Economic environment', type: 'choice', controllable: true,
        question: 'Where do you live and work?',
        why: 'High-growth economies and cities offer more upside (and higher costs).',
        options: [
          { label: 'Major high-income city / tech hub', logLR: 0.3, prior: 2 },
          { label: 'Fast-growing economy', logLR: 0.2, prior: 1.5 },
          { label: 'Average region', logLR: 0, prior: 3 },
          { label: 'Economically struggling region', logLR: -0.4, prior: 1.5 },
        ],
      },
      {
        id: 'health', label: 'Health & stability', type: 'yesno', controllable: true,
        question: 'Are you in good health with a stable personal life (no major ongoing crises)?',
        why: 'Illness, divorce and other shocks are among the most common causes of wealth loss.',
        options: yesNo(0.15, -0.4, 4, 1),
      },
    ],
  },

  {
    id: 'startup',
    title: 'Will my startup succeed?',
    keywords: ['startup', 'start-up', 'my company', 'founder', 'business succeed', 'unicorn', 'venture', 'raise funding', 'series a', 'my business', 'saas', 'product market fit'],
    question: 'Will my startup succeed?',
    outcome: 'The company reaches sustainable profitability or a successful exit (acquisition/IPO that returns investors’ money) instead of shutting down.',
    horizon: 'Within 7 years of founding',
    domain: 'business',
    baseRate: 0.1,
    baseRateNote: 'Around 90% of startups fail; roughly 10% reach profitability or a meaningful exit. Venture-backed startups have similar odds of returning capital.',
    dependence: 0.3,
    factors: [
      {
        id: 'founder_experience', label: 'Founder track record', type: 'choice', controllable: false,
        question: 'Have you (or a co-founder) built a company before?',
        why: 'Founders with a prior successful exit have roughly 2× the success rate of first-timers.',
        options: [
          { label: 'First-time founders', logLR: -0.15, prior: 5 },
          { label: 'Previous startup that failed', logLR: 0.15, prior: 2 },
          { label: 'Previous successful exit', logLR: 0.8, prior: 0.6 },
        ],
      },
      {
        id: 'team', label: 'Team', type: 'choice', controllable: true,
        question: 'What does the founding team look like?',
        why: 'Solo founders struggle more; complementary co-founders (builder + seller) cover more failure modes.',
        options: [
          { label: 'Solo founder', logLR: -0.3, prior: 3 },
          { label: 'Co-founders with overlapping skills', logLR: 0, prior: 2 },
          { label: 'Complementary co-founders (build + sell)', logLR: 0.5, prior: 2 },
        ],
      },
      {
        id: 'domain', label: 'Domain expertise', type: 'scale', controllable: false,
        question: 'How deeply do you know the problem and the customer?',
        why: 'Founders who lived the problem find product–market fit faster.',
        options: [
          { label: 'New to this space', logLR: -0.5, prior: 2 },
          { label: 'Some exposure', logLR: 0, prior: 3 },
          { label: 'Years of insider experience', logLR: 0.6, prior: 1.5 },
        ],
      },
      {
        id: 'traction', label: 'Traction', type: 'choice', controllable: true,
        question: 'What traction do you have today?',
        why: 'Paying customers are the single strongest early signal. Ideas are cheap; revenue is evidence.',
        options: [
          { label: 'Just an idea', logLR: -0.8, prior: 3 },
          { label: 'Prototype / waitlist', logLR: -0.3, prior: 3 },
          { label: 'Some paying customers', logLR: 0.5, prior: 2 },
          { label: 'Fast-growing revenue (>15% MoM)', logLR: 1.5, prior: 0.5 },
        ],
      },
      {
        id: 'retention', label: 'Retention', type: 'scale', controllable: true,
        askIf: { factorId: 'traction', optionIndexes: [2, 3] },
        question: 'Do customers stick around and use it repeatedly?',
        why: 'Retention is the purest product–market-fit signal. Leaky buckets kill growth.',
        options: [
          { label: 'Most churn quickly', logLR: -0.8, prior: 1 },
          { label: 'Mixed', logLR: 0, prior: 2 },
          { label: 'Strong — they’d be upset if we disappeared', logLR: 0.9, prior: 1 },
        ],
      },
      {
        id: 'market', label: 'Market', type: 'scale', controllable: true,
        question: 'How big and fast-growing is your market?',
        why: '“No market need” is the most commonly cited reason startups die.',
        options: [
          { label: 'Small or shrinking', logLR: -0.7, prior: 1 },
          { label: 'Medium, stable', logLR: 0, prior: 2 },
          { label: 'Large and growing', logLR: 0.5, prior: 2 },
        ],
      },
      {
        id: 'runway', label: 'Runway', type: 'choice', controllable: true,
        question: 'How many months can you operate before running out of money?',
        why: 'Running out of cash is the proximate cause of most startup deaths.',
        options: [
          { label: 'Less than 6 months', logLR: -0.6, prior: 2 },
          { label: '6–18 months', logLR: 0, prior: 3 },
          { label: '18+ months or already profitable', logLR: 0.6, prior: 1.5 },
        ],
      },
      {
        id: 'commitment', label: 'Commitment', type: 'yesno', controllable: true,
        question: 'Are the founders working on it full-time?',
        why: 'Part-time startups rarely beat full-time competitors.',
        options: yesNo(0.3, -0.6, 2, 1),
      },
      {
        id: 'moat', label: 'Defensibility', type: 'scale', controllable: true,
        question: 'How hard would it be for a well-funded competitor to copy you?',
        why: 'Network effects, proprietary data, brand or deep tech protect margins.',
        options: [
          { label: 'Easy to copy', logLR: -0.4, prior: 3 },
          { label: 'Some advantages', logLR: 0.1, prior: 2 },
          { label: 'Strong moat', logLR: 0.6, prior: 0.8 },
        ],
      },
    ],
  },

  {
    id: 'marriage',
    title: 'Will my relationship last?',
    keywords: ['relationship', 'marriage', 'married', 'girlfriend', 'boyfriend', 'partner', 'wife', 'husband', 'divorce', 'break up', 'breakup', 'love', 'soulmate', 'last forever', 'together'],
    question: 'Will my relationship last?',
    outcome: 'You and your current partner are still together and both reasonably satisfied.',
    horizon: '10 years from now',
    domain: 'relationships',
    baseRate: 0.55,
    baseRateNote: 'Across committed adult couples, roughly half to two-thirds are still together after 10 years; first marriages last longer than dating relationships.',
    dependence: 0.3,
    factors: [
      {
        id: 'status', label: 'Commitment stage', type: 'choice', controllable: false,
        question: 'What stage is the relationship at?',
        why: 'Later stages already filtered out many fragile couples.',
        options: [
          { label: 'Dating < 1 year', logLR: -0.7, prior: 2 },
          { label: 'Dating 1+ years', logLR: -0.2, prior: 2 },
          { label: 'Engaged / living together', logLR: 0.1, prior: 2 },
          { label: 'Married', logLR: 0.35, prior: 3 },
        ],
      },
      {
        id: 'contempt', label: 'Conflict style', type: 'choice', controllable: true,
        question: 'When you argue, which is most common?',
        why: 'Gottman’s research: contempt, criticism, defensiveness and stonewalling (“the four horsemen”) predict breakups with high accuracy.',
        options: [
          { label: 'We talk it through and repair quickly', logLR: 0.8, prior: 2 },
          { label: 'Heated but we get over it', logLR: 0, prior: 3 },
          { label: 'Silent treatment / avoiding each other', logLR: -0.6, prior: 1.5 },
          { label: 'Eye-rolling, insults, contempt', logLR: -1.4, prior: 1 },
        ],
      },
      {
        id: 'values', label: 'Shared goals', type: 'scale', controllable: false,
        question: 'Do you agree on the big things (kids, money, where to live, religion)?',
        why: 'Misaligned life goals rarely fade with time — they get sharper.',
        options: [
          { label: 'Big disagreements', logLR: -0.9, prior: 1 },
          { label: 'Some open questions', logLR: -0.1, prior: 2 },
          { label: 'Strongly aligned', logLR: 0.6, prior: 2 },
        ],
      },
      {
        id: 'friendship', label: 'Friendship', type: 'scale', controllable: true,
        question: 'How much do you genuinely enjoy each other’s company day to day?',
        why: 'Friendship and positive daily interactions buffer couples against stress.',
        options: [
          { label: 'Rarely', logLR: -1.0, prior: 1 },
          { label: 'Sometimes', logLR: -0.2, prior: 2 },
          { label: 'Often', logLR: 0.4, prior: 3 },
          { label: 'Best friends', logLR: 0.8, prior: 1.5 },
        ],
      },
      {
        id: 'trust', label: 'Trust', type: 'yesno', controllable: false,
        question: 'Has there been infidelity or a serious breach of trust?',
        why: 'Betrayal is one of the strongest predictors of separation, though many couples do recover.',
        options: yesNo(-0.9, 0.15, 1, 4),
      },
      {
        id: 'stress', label: 'External stress', type: 'choice', controllable: true,
        question: 'Is the relationship under heavy outside pressure right now?',
        why: 'Money trouble, long distance and family conflict all raise breakup risk.',
        options: [
          { label: 'Very little', logLR: 0.2, prior: 2 },
          { label: 'Some', logLR: 0, prior: 3 },
          { label: 'A lot (money, distance, family)', logLR: -0.5, prior: 1.5 },
        ],
      },
      {
        id: 'age_met', label: 'Age when committed', type: 'choice', controllable: false,
        question: 'How old were you both when you got together?',
        why: 'Couples who commit in their teens or very early twenties separate more often.',
        options: [
          { label: 'Under 22', logLR: -0.4, prior: 1 },
          { label: '22–30', logLR: 0.1, prior: 3 },
          { label: 'Over 30', logLR: 0.15, prior: 2 },
        ],
      },
    ],
  },

  {
    id: 'longevity',
    title: 'Will I live to 90?',
    keywords: ['live to', 'live long', 'longevity', 'life expectancy', 'die', 'lifespan', 'age 90', 'age 100', 'centenarian', 'healthy old'],
    question: 'Will I live to 90?',
    outcome: 'You reach your 90th birthday.',
    horizon: 'Age 90',
    domain: 'health',
    baseRate: 0.25,
    baseRateNote: 'In high-income countries roughly 20–30% of people born today reach 90 (more women than men). Lifestyle factors shift this substantially.',
    dependence: 0.25,
    caveat: 'Not medical advice. Talk to a doctor about your personal risks.',
    factors: [
      {
        id: 'sex', label: 'Sex', type: 'choice', controllable: false,
        question: 'What is your sex at birth?',
        why: 'Women live ~4–5 years longer on average and are much more likely to reach 90.',
        options: [
          { label: 'Female', logLR: 0.35, prior: 1 },
          { label: 'Male', logLR: -0.35, prior: 1 },
          { label: 'Prefer not to say', logLR: 0, prior: 0.2 },
        ],
      },
      {
        id: 'smoking', label: 'Smoking', type: 'choice', controllable: true,
        question: 'Do you smoke?',
        why: 'Smoking cuts life expectancy by about 10 years — the largest single modifiable factor.',
        options: [
          { label: 'Never', logLR: 0.25, prior: 5 },
          { label: 'Quit more than 5 years ago', logLR: 0, prior: 2 },
          { label: 'Yes, occasionally', logLR: -0.6, prior: 1 },
          { label: 'Yes, daily', logLR: -1.4, prior: 1.5 },
        ],
      },
      {
        id: 'exercise', label: 'Exercise', type: 'scale', controllable: true,
        question: 'How active are you in a typical week?',
        why: 'Cardiorespiratory fitness is among the strongest predictors of longevity.',
        options: [
          { label: 'Mostly sedentary', logLR: -0.6, prior: 3 },
          { label: 'Some activity', logLR: 0, prior: 3 },
          { label: '150+ min moderate exercise', logLR: 0.4, prior: 2 },
          { label: 'Very fit, train hard regularly', logLR: 0.7, prior: 0.8 },
        ],
      },
      {
        id: 'weight', label: 'Body weight', type: 'choice', controllable: true,
        question: 'Which describes your weight?',
        why: 'Severe obesity raises cardiovascular and metabolic risk.',
        options: [
          { label: 'Healthy range', logLR: 0.15, prior: 3 },
          { label: 'Somewhat overweight', logLR: -0.05, prior: 3 },
          { label: 'Obese', logLR: -0.6, prior: 2 },
          { label: 'Underweight', logLR: -0.3, prior: 0.3 },
        ],
      },
      {
        id: 'family', label: 'Family longevity', type: 'yesno', controllable: false,
        question: 'Did any parent or grandparent live past 90?',
        why: 'Longevity is partly heritable, especially at extreme ages.',
        options: yesNo(0.5, -0.1, 1, 2),
      },
      {
        id: 'alcohol', label: 'Alcohol', type: 'choice', controllable: true,
        question: 'How much alcohol do you drink?',
        why: 'Heavy drinking raises cancer, liver and accident risk.',
        options: [
          { label: 'None or rarely', logLR: 0.1, prior: 3 },
          { label: 'Moderate (≤7 drinks/week)', logLR: 0, prior: 3 },
          { label: 'Heavy (15+ drinks/week)', logLR: -0.7, prior: 1 },
        ],
      },
      {
        id: 'conditions', label: 'Chronic conditions', type: 'choice', controllable: false,
        question: 'Do you have a serious chronic condition (heart disease, diabetes, cancer history)?',
        why: 'Existing disease shifts risk, though well-managed conditions matter much less.',
        options: [
          { label: 'None', logLR: 0.2, prior: 4 },
          { label: 'One, well managed', logLR: -0.3, prior: 1.5 },
          { label: 'One or more, poorly controlled', logLR: -1.0, prior: 0.7 },
        ],
      },
      {
        id: 'social', label: 'Social connection', type: 'scale', controllable: true,
        question: 'How socially connected are you?',
        why: 'Loneliness carries mortality risk comparable to smoking 15 cigarettes a day.',
        options: [
          { label: 'Often isolated', logLR: -0.4, prior: 1.5 },
          { label: 'Some close ties', logLR: 0, prior: 3 },
          { label: 'Strong relationships & community', logLR: 0.3, prior: 2 },
        ],
      },
      {
        id: 'sleep', label: 'Sleep', type: 'choice', controllable: true,
        question: 'How much do you usually sleep?',
        why: 'Chronic short sleep is linked to cardiovascular and metabolic disease.',
        options: [
          { label: 'Under 6 hours', logLR: -0.3, prior: 1.5 },
          { label: '6–9 hours', logLR: 0.1, prior: 4 },
          { label: 'Over 9 hours', logLR: -0.15, prior: 0.6 },
        ],
      },
    ],
  },

  {
    id: 'job',
    title: 'Will I land my dream job?',
    keywords: ['job', 'hired', 'get hired', 'interview', 'offer', 'dream job', 'promotion', 'promoted', 'google', 'microsoft', 'faang', 'career', 'internship', 'placement'],
    question: 'Will I land my dream job?',
    outcome: 'You receive and accept an offer for the role (or a role of that level) you’re aiming for.',
    horizon: 'Within 12 months',
    domain: 'career',
    baseRate: 0.3,
    baseRateNote: 'For people actively pursuing a competitive target role, roughly a quarter to a third land it within a year; the rest either wait longer or pivot.',
    dependence: 0.25,
    factors: [
      {
        id: 'fit', label: 'Qualification fit', type: 'scale', controllable: true,
        question: 'How well do your skills and experience match what the role requires?',
        why: 'Meeting most stated requirements is the gate to being seriously considered.',
        options: [
          { label: 'I meet less than half', logLR: -1.0, prior: 1.5 },
          { label: 'About half', logLR: -0.3, prior: 2 },
          { label: 'Most of them', logLR: 0.4, prior: 3 },
          { label: 'All, and then some', logLR: 0.8, prior: 1 },
        ],
      },
      {
        id: 'applications', label: 'Search volume', type: 'choice', controllable: true,
        question: 'How many relevant applications will you send / have you sent?',
        why: 'Job search is a numbers game: odds compound across applications.',
        options: [
          { label: '1–5', logLR: -0.6, prior: 2 },
          { label: '6–25', logLR: 0, prior: 3 },
          { label: '25–100', logLR: 0.5, prior: 2 },
          { label: '100+', logLR: 0.7, prior: 0.7 },
        ],
      },
      {
        id: 'referral', label: 'Referrals', type: 'yesno', controllable: true,
        question: 'Do you have a referral or insider contact at your target companies?',
        why: 'Referred candidates are several times more likely to be hired.',
        options: yesNo(0.7, -0.2, 1, 2),
      },
      {
        id: 'interview', label: 'Interview performance', type: 'scale', controllable: true,
        question: 'How do you usually perform in interviews for roles like this?',
        why: 'Interviews are a learnable skill; deliberate practice moves the needle fast.',
        options: [
          { label: 'Poorly / no experience', logLR: -0.6, prior: 1.5 },
          { label: 'Mixed', logLR: 0, prior: 3 },
          { label: 'I usually reach final rounds', logLR: 0.6, prior: 1.5 },
        ],
      },
      {
        id: 'prep', label: 'Preparation', type: 'choice', controllable: true,
        question: 'How many hours per week are you putting into preparation?',
        why: 'Focused preparation (portfolio, mock interviews, practice problems) is the most controllable lever.',
        options: [
          { label: 'Under 2', logLR: -0.5, prior: 2 },
          { label: '2–8', logLR: 0, prior: 3 },
          { label: '8–20', logLR: 0.4, prior: 1.5 },
          { label: '20+', logLR: 0.6, prior: 0.6 },
        ],
      },
      {
        id: 'market', label: 'Hiring market', type: 'choice', controllable: false,
        question: 'How is hiring in your field right now?',
        why: 'Market conditions set the tide everyone swims in.',
        options: [
          { label: 'Frozen / layoffs', logLR: -0.6, prior: 1.5 },
          { label: 'Normal', logLR: 0, prior: 3 },
          { label: 'Hot — companies are competing for people', logLR: 0.5, prior: 1 },
        ],
      },
      {
        id: 'proof', label: 'Visible proof of skill', type: 'choice', controllable: true,
        question: 'Do you have visible proof of your ability (portfolio, publications, projects, strong references)?',
        why: 'Concrete evidence beats claims on a CV.',
        options: [
          { label: 'Nothing yet', logLR: -0.4, prior: 2 },
          { label: 'Some', logLR: 0.1, prior: 3 },
          { label: 'Strong, specific track record', logLR: 0.6, prior: 1 },
        ],
      },
    ],
  },

  {
    id: 'exam',
    title: 'Will I pass my exam?',
    keywords: ['exam', 'test', 'pass', 'jee', 'neet', 'upsc', 'gate exam', 'cat exam', 'gre', 'gmat', 'sat', 'bar exam', 'board', 'admission', 'get into', 'university', 'college', 'certification', 'grade'],
    question: 'Will I pass my exam / get the score I need?',
    outcome: 'You achieve the score or rank you need for your goal.',
    horizon: 'On the next attempt',
    domain: 'education',
    baseRate: 0.5,
    baseRateNote: 'Pass rates vary hugely by exam. Answer the first question to set the right reference class.',
    dependence: 0.3,
    factors: [
      {
        id: 'difficulty', kind: 'prior', label: 'Reference class', type: 'choice',
        question: 'Roughly what share of candidates achieve the result you need?',
        why: 'This is the base rate: competitive entrance exams and licensing exams differ by 50× in selectivity.',
        options: [
          { label: 'Most pass (70%+)', p: 0.75 },
          { label: 'About half', p: 0.5 },
          { label: 'Around 1 in 4', p: 0.25 },
          { label: 'Around 1 in 10', p: 0.1 },
          { label: 'Highly selective (<2%)', p: 0.02 },
        ],
      },
      {
        id: 'mocks', label: 'Mock test scores', type: 'scale', controllable: true,
        question: 'How do your recent practice/mock test scores compare to the target?',
        why: 'Mock performance is the single best predictor of the real result.',
        options: [
          { label: 'Well below target', logLR: -1.4, prior: 2 },
          { label: 'Slightly below', logLR: -0.4, prior: 2 },
          { label: 'Around target', logLR: 0.4, prior: 2 },
          { label: 'Comfortably above', logLR: 1.3, prior: 1 },
          { label: 'Haven’t taken any yet', logLR: -0.2, prior: 1.5 },
        ],
      },
      {
        id: 'syllabus', label: 'Syllabus coverage', type: 'scale', controllable: true,
        question: 'How much of the syllabus have you covered thoroughly?',
        why: 'Gaps in coverage translate directly into lost marks.',
        options: [
          { label: 'Under 40%', logLR: -0.9, prior: 1.5 },
          { label: '40–70%', logLR: -0.2, prior: 2 },
          { label: '70–90%', logLR: 0.3, prior: 2 },
          { label: 'All of it, revised', logLR: 0.7, prior: 1 },
        ],
      },
      {
        id: 'hours', label: 'Study hours', type: 'choice', controllable: true,
        question: 'How many focused study hours per week until the exam?',
        why: 'Deliberate, focused hours (not time at the desk) drive improvement.',
        options: [
          { label: 'Under 5', logLR: -0.6, prior: 2 },
          { label: '5–15', logLR: 0, prior: 3 },
          { label: '15–30', logLR: 0.35, prior: 2 },
          { label: '30+', logLR: 0.5, prior: 1 },
        ],
      },
      {
        id: 'time_left', label: 'Time left', type: 'choice', controllable: false,
        question: 'How long until the exam?',
        why: 'More time means more room to close gaps — if you use it.',
        options: [
          { label: 'Under 2 weeks', logLR: -0.2, prior: 1 },
          { label: '2 weeks – 3 months', logLR: 0, prior: 2 },
          { label: '3+ months', logLR: 0.2, prior: 2 },
        ],
      },
      {
        id: 'past', label: 'Past performance', type: 'choice', controllable: false,
        question: 'How have you done in similar exams before?',
        why: 'Track record captures ability and test-taking skill.',
        options: [
          { label: 'Usually below what I need', logLR: -0.5, prior: 1.5 },
          { label: 'Average', logLR: 0, prior: 3 },
          { label: 'Usually top of the class', logLR: 0.6, prior: 1.2 },
        ],
      },
      {
        id: 'anxiety', label: 'Exam nerves', type: 'yesno', controllable: true,
        question: 'Does anxiety usually hurt your performance on the day?',
        why: 'Test anxiety can cost a meaningful chunk of marks; it’s trainable with timed practice.',
        options: yesNo(-0.35, 0.1, 1, 2),
      },
    ],
  },

  {
    id: 'fitness',
    title: 'Will I reach my fitness goal?',
    keywords: ['lose weight', 'weight loss', 'fit', 'fitness', 'six pack', 'abs', 'marathon', 'gym', 'muscle', 'kg', 'pounds', 'lbs', 'diet', 'get in shape'],
    question: 'Will I reach my fitness / weight goal?',
    outcome: 'You reach the goal and maintain it for at least 6 months.',
    horizon: '12 months',
    domain: 'health',
    baseRate: 0.2,
    baseRateNote: 'Only about 20% of people who set a weight or fitness goal reach it and keep it for six months or more.',
    dependence: 0.3,
    caveat: 'Not medical advice.',
    factors: [
      {
        id: 'ambition', label: 'Goal size', type: 'choice', controllable: true,
        question: 'How ambitious is the goal relative to where you are now?',
        why: 'Moderate goals (5–10% body weight, a first 10K) are hit far more often than dramatic ones.',
        options: [
          { label: 'Modest', logLR: 0.6, prior: 2 },
          { label: 'Significant', logLR: 0, prior: 3 },
          { label: 'Dramatic', logLR: -0.7, prior: 1.5 },
        ],
      },
      {
        id: 'plan', label: 'Concrete plan', type: 'yesno', controllable: true,
        question: 'Do you have a specific written plan (what, when, where)?',
        why: 'Implementation intentions roughly double follow-through.',
        options: yesNo(0.5, -0.3, 1, 2),
      },
      {
        id: 'tracking', label: 'Tracking', type: 'yesno', controllable: true,
        question: 'Do you track food, workouts or progress at least weekly?',
        why: 'Self-monitoring is one of the most consistent predictors of success.',
        options: yesNo(0.6, -0.3, 1, 2),
      },
      {
        id: 'history', label: 'Past attempts', type: 'choice', controllable: false,
        question: 'How did your previous attempts go?',
        why: 'History of yo-yo attempts predicts relapse, but past success predicts repeat success.',
        options: [
          { label: 'First real attempt', logLR: 0, prior: 2 },
          { label: 'Tried several times, regained', logLR: -0.4, prior: 3 },
          { label: 'Succeeded before', logLR: 0.5, prior: 1 },
        ],
      },
      {
        id: 'support', label: 'Support', type: 'yesno', controllable: true,
        question: 'Do you have a coach, partner or group holding you accountable?',
        why: 'Accountability and social support improve adherence.',
        options: yesNo(0.5, -0.1, 1, 2),
      },
      {
        id: 'environment', label: 'Environment', type: 'scale', controllable: true,
        question: 'How supportive is your daily environment (home food, schedule, gym access)?',
        why: 'Willpower is unreliable; environment design does the heavy lifting.',
        options: [
          { label: 'Works against me', logLR: -0.5, prior: 1.5 },
          { label: 'Neutral', logLR: 0, prior: 3 },
          { label: 'Set up for success', logLR: 0.5, prior: 1.5 },
        ],
      },
      {
        id: 'motivation', label: 'Motivation', type: 'choice', controllable: false,
        question: 'Why do you want this?',
        why: 'Intrinsic, identity-based motivation lasts; external pressure fades.',
        options: [
          { label: 'Someone else wants me to', logLR: -0.5, prior: 1 },
          { label: 'A deadline or event', logLR: -0.1, prior: 2 },
          { label: 'Health / how I want to live', logLR: 0.4, prior: 3 },
        ],
      },
    ],
  },

  {
    id: 'habit',
    title: 'Will I stick to it?',
    keywords: ['habit', 'stick to', 'resolution', 'consistent', 'quit', 'stop', 'start', 'learn', 'language', 'meditate', 'read more', 'routine', 'discipline'],
    question: 'Will I stick to my new habit or goal?',
    outcome: 'You are still doing the habit at least 4 days a week.',
    horizon: '6 months from now',
    domain: 'personal growth',
    baseRate: 0.2,
    baseRateNote: 'Studies of New Year’s resolutions find roughly 1 in 5 people are still on track after six months.',
    dependence: 0.3,
    factors: [
      {
        id: 'size', label: 'Habit size', type: 'choice', controllable: true,
        question: 'How big is the daily commitment?',
        why: 'Tiny habits survive bad days; big ones don’t.',
        options: [
          { label: 'Under 10 minutes', logLR: 0.6, prior: 1.5 },
          { label: '10–45 minutes', logLR: 0, prior: 3 },
          { label: 'Over 45 minutes', logLR: -0.5, prior: 1.5 },
        ],
      },
      {
        id: 'cue', label: 'Trigger', type: 'yesno', controllable: true,
        question: 'Is it attached to a fixed trigger (after coffee, before bed, a set time)?',
        why: 'Habit stacking on an existing routine makes the behaviour automatic.',
        options: yesNo(0.6, -0.3, 1, 2),
      },
      {
        id: 'enjoy', label: 'Enjoyment', type: 'scale', controllable: true,
        question: 'Do you enjoy doing it?',
        why: 'Immediate reward predicts persistence far better than long-term benefits.',
        options: [
          { label: 'I dread it', logLR: -0.7, prior: 1 },
          { label: 'Neutral', logLR: 0, prior: 3 },
          { label: 'I like it', logLR: 0.6, prior: 2 },
        ],
      },
      {
        id: 'identity', label: 'Identity', type: 'yesno', controllable: true,
        question: 'Do you see it as part of who you are ("I am a runner") rather than a task?',
        why: 'Identity-based habits survive motivation dips.',
        options: yesNo(0.5, -0.1, 1, 2),
      },
      {
        id: 'accountability', label: 'Accountability', type: 'yesno', controllable: true,
        question: 'Does anyone else know about it and check in?',
        why: 'Public commitment and check-ins raise follow-through.',
        options: yesNo(0.4, -0.1, 1, 2),
      },
      {
        id: 'track_record', label: 'Track record', type: 'choice', controllable: false,
        question: 'How have your past habit attempts gone?',
        why: 'Past behaviour is the best predictor of future behaviour.',
        options: [
          { label: 'Usually drop off in weeks', logLR: -0.6, prior: 3 },
          { label: 'Mixed', logLR: 0, prior: 3 },
          { label: 'I usually stick with things', logLR: 0.6, prior: 1.5 },
        ],
      },
    ],
  },
];

/**
 * Universal model used when no specialised model fits. It frames any goal or
 * event through the factors that matter across domains: base rate, control,
 * preparation, resources, track record, commitment and external risk.
 */
export function genericModel(question) {
  const q = String(question || 'Will this happen?').trim();
  return {
    id: 'generic',
    title: q,
    question: q,
    outcome: `This happens as you described it: “${q.replace(/\?+$/, '')}”.`,
    horizon: 'In the time frame you have in mind',
    domain: 'general',
    baseRate: 0.35,
    baseRateNote: 'Oracle has no specialised model for this question, so it starts from the reference class you choose in the first question.',
    dependence: 0.3,
    source: 'generic',
    caveat: 'Generic model. Connect Claude (set ANTHROPIC_API_KEY) for a model tailored to this exact question.',
    factors: [
      {
        id: 'reference', kind: 'prior', label: 'Reference class', type: 'choice',
        question: 'Think of people (or situations) like yours who wanted this. Roughly how often does it happen?',
        why: 'Superforecasters always start from the base rate (“the outside view”) before considering specifics.',
        options: [
          { label: 'Almost always (≈90%)', p: 0.9 },
          { label: 'Usually (≈70%)', p: 0.7 },
          { label: 'About half the time', p: 0.5 },
          { label: 'Sometimes (≈25%)', p: 0.25 },
          { label: 'Rarely (≈10%)', p: 0.1 },
          { label: 'Very rarely (≈2%)', p: 0.02 },
          { label: 'No idea', p: 0.35 },
        ],
      },
      {
        id: 'control', label: 'Control', type: 'scale', controllable: false,
        question: 'How much of the outcome depends on your own actions (vs. luck or other people)?',
        why: 'The more it depends on you, the more the remaining answers matter.',
        options: [
          { label: 'Almost none', logLR: -0.2, prior: 1 },
          { label: 'Some', logLR: 0, prior: 2 },
          { label: 'Most of it', logLR: 0.2, prior: 2 },
        ],
      },
      {
        id: 'preparation', label: 'Preparation', type: 'scale', controllable: true,
        question: 'How prepared are you compared to others who succeeded?',
        why: 'Preparation relative to the competition is the most portable predictor of success.',
        options: [
          { label: 'Much less', logLR: -1.0, prior: 1.5 },
          { label: 'A bit less', logLR: -0.4, prior: 2 },
          { label: 'About the same', logLR: 0.1, prior: 2 },
          { label: 'More prepared', logLR: 0.7, prior: 1 },
        ],
      },
      {
        id: 'track_record', label: 'Track record', type: 'choice', controllable: false,
        question: 'Have you achieved something similar before?',
        why: 'Past success at comparable tasks is strong evidence of capability.',
        options: [
          { label: 'Yes, more than once', logLR: 0.8, prior: 1 },
          { label: 'Once', logLR: 0.4, prior: 1.5 },
          { label: 'Tried and failed', logLR: -0.2, prior: 1.5 },
          { label: 'Never tried', logLR: -0.1, prior: 2 },
        ],
      },
      {
        id: 'resources', label: 'Resources', type: 'scale', controllable: true,
        question: 'Do you have the money, time, tools and access it requires?',
        why: 'Resource gaps are a common hidden failure mode.',
        options: [
          { label: 'Major gaps', logLR: -0.8, prior: 1.5 },
          { label: 'Some gaps', logLR: -0.2, prior: 2 },
          { label: 'Fully resourced', logLR: 0.5, prior: 1.5 },
        ],
      },
      {
        id: 'commitment', label: 'Commitment', type: 'scale', controllable: true,
        question: 'How committed are you, honestly, on a hard week?',
        why: 'Persistence through setbacks separates outcomes more than talent does.',
        options: [
          { label: 'I’d probably give up', logLR: -0.8, prior: 1 },
          { label: 'Depends on the week', logLR: -0.1, prior: 2.5 },
          { label: 'I’ll keep going no matter what', logLR: 0.6, prior: 1.5 },
        ],
      },
      {
        id: 'support', label: 'Support', type: 'yesno', controllable: true,
        question: 'Do you have mentors, allies or people who have done this helping you?',
        why: 'Guidance from people who have done it shortcuts expensive mistakes.',
        options: yesNo(0.4, -0.15, 1, 1.5),
      },
      {
        id: 'blockers', label: 'External risks', type: 'scale', controllable: false,
        question: 'How likely is something outside your control to block it (rules, competition, economy, other people)?',
        why: 'External blockers can override everything else.',
        options: [
          { label: 'Very likely', logLR: -0.9, prior: 1 },
          { label: 'Possible', logLR: -0.2, prior: 2.5 },
          { label: 'Unlikely', logLR: 0.3, prior: 2 },
        ],
      },
      {
        id: 'time', label: 'Time available', type: 'choice', controllable: false,
        question: 'Is the time frame realistic for what’s required?',
        why: 'Planning fallacy: most things take longer than expected.',
        options: [
          { label: 'Tight — it would need everything to go right', logLR: -0.6, prior: 1.5 },
          { label: 'Realistic', logLR: 0.1, prior: 2 },
          { label: 'Generous', logLR: 0.4, prior: 1 },
        ],
      },
    ],
  };
}

/**
 * Pick the best built-in model for a free-text question. Returns the model and
 * a match score (0 when falling back to the generic model).
 */
export function matchLibrary(question) {
  const q = ` ${String(question || '').toLowerCase()} `;
  let best = null;
  for (const m of LIBRARY) {
    let score = 0;
    for (const k of m.keywords) {
      const re = new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
      if (re.test(q)) score += k.includes(' ') ? 2 : 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { model: m, score };
  }
  if (!best) return { model: genericModel(question), score: 0 };
  const { keywords, ...model } = best.model;
  return { model: { ...model, question: String(question).trim() || model.question, source: 'library' }, score: best.score };
}
