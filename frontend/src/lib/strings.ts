// User-facing text in English, Filipino and Bisaya (Cebuano), for the screens
// the UIC-REC asked to be available in the participants' languages: consent,
// the screening flow, the results screen and its disclaimers, the chat
// notices, and the site frame.
//
// ⚠️ DRAFT TRANSLATIONS. The Filipino and Bisaya text was drafted for BATO and
// MUST be reviewed by a fluent speaker on the research team before the study.
// Medical terms keep the English word in parentheses where Filipinos commonly
// know the English term better than a translation.
//
// Kept in English everywhere, on purpose:
//   - chatbot answers (the knowledge base and its safety checks are English);
//   - SUS / TAM / TiMT survey items (validated instruments: translating them
//     needs its own validation);
//   - "Screen Positive" / "Screen Negative" (the SCORED instrument's terms).
//
// Screening answers are always SENT in English ("Yes", "Male", …) — only the
// button labels change — so the server's deterministic scoring never depends
// on a translation.

export type Lang = "en" | "fil" | "ceb";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fil", label: "Filipino" },
  { code: "ceb", label: "Bisaya" },
];

export type ScreeningKey =
  | "age"
  | "female"
  | "anemia"
  | "hypertension"
  | "diabetes"
  | "cvd_history"
  | "chf_history"
  | "pvd"
  | "proteinuria";

/** Codes the screening server attaches to a rejected answer (questions.ts). */
export type InvalidCode =
  | "age_format"
  | "age_range"
  | "age_under_min"
  | "sex"
  | "yes_no"
  | "unsure"
  | "unsure_recall"
  | "yes_no_unsure";

export interface Strings {
  nav: { assessment: string; chat: string; labs: string; feedback: string };
  languageLabel: string;
  footer: { lead: string; body: string };
  consent: {
    eyebrow: string;
    title: string;
    intro: string;
    aiTitle: string;
    aiBody: string;
    dataTitle: string;
    dataItems: string[];
    voluntary: string;
    checkAge: string;
    checkHealth: string;
    checkAgree: string;
    accept: string;
    decline: string;
  };
  assessment: {
    eyebrow: string;
    title: string;
    subtitle: string;
    step: (n: number, total: number) => string;
    notice: string;
    explainButton: string;
    explainChip: string;
    answerLabel: string;
    answerOrAskLabel: string;
    numberPlaceholder: string;
    textPlaceholder: string;
    send: string;
    you: string;
    bato: string;
    unavailableTitle: string;
    tryAgain: string;
    somethingWrong: string;
  };
  questions: Record<ScreeningKey, string>;
  /** Button labels for the canonical English option values. */
  options: Record<string, string>;
  invalid: (code: InvalidCode) => string;
  results: {
    eyebrow: string;
    disclaimerTitle: string;
    disclaimerBody: string;
    scoreLabel: string;
    positiveTitle: string;
    positiveBody: string;
    positiveNextTitle: string;
    positiveNext: string;
    findLab: string;
    confirmLab: string;
    negativeTitle: string;
    negativeBody: string;
    negativeWarningTitle: string;
    negativeWarning: string;
    negativeNextTitle: string;
    negativeNext: string;
    accuracyTitle: string;
    accuracyBody: string;
    retake: string;
    askChat: string;
  };
  chat: {
    eyebrow: string;
    title: string;
    subtitle: string;
    badge: string;
    notice: string;
    emptyTitle: string;
    emptyLead: string;
    tryQuestion: string;
    inputLabel: string;
    placeholder: string;
    send: string;
    you: string;
    bato: string;
    sources: string;
    replying: string;
    somethingWrong: string;
  };
  feedback: {
    eyebrow: string;
    title: string;
    body: string;
    button: string;
    newTab: string;
    unavailable: string;
    thanks: string;
  };
}

const en: Strings = {
  nav: { assessment: "Assessment", chat: "Kidney chat", labs: "Find labs", feedback: "Feedback" },
  languageLabel: "Language",
  footer: {
    lead: "For awareness, not diagnosis.",
    body: "BATO is a screening tool, not a medical device. Results and chat responses are not medical advice. Consult a health professional about your health. SCORED is used under license from AstraZeneca Philippines (PH-6850).",
  },
  consent: {
    eyebrow: "Before you start",
    title: "Please read this first",
    intro: "BATO is a research project of the College of Computer Studies, University of the Immaculate Conception, Davao City. It checks your risk of Chronic Kidney Disease (CKD) using the SCORED questionnaire. It is a screening tool only: it does not diagnose any disease and does not replace a doctor.",
    aiTitle: "You will be using an AI-powered chatbot",
    aiBody: "BATO's chat answers, and its explanations of the screening questions, are written by artificial intelligence (AI) using trusted health sources. AI can make mistakes or leave things out. Do not use it to make medical decisions. Talk to a doctor.",
    dataTitle: "What happens to your information",
    dataItems: [
      "No name, email or account is needed. Your session is anonymous.",
      "Your screening answers and result are deleted as soon as your result is shown. BATO does not keep them.",
      "Questions you type to BATO's chatbots, and BATO's replies, are kept without your name so the research team can check that the information was accurate. Only the research team can see them.",
      "To answer you, the questions you type are sent to online AI services (Google Gemini, Groq and Cohere) through BATO's host, Supabase. These companies handle the questions under their own terms. Please do not type your name, contact details, or anything else that could identify you.",
      "The feedback surveys are on Google Forms, so Google receives the answers you choose to submit. The research team keeps them for the study's evaluation.",
    ],
    voluntary: "Taking part is voluntary. You may take a break or stop at any time without any penalty. You may ask the researchers questions at any time.",
    checkAge: "I am 20 years old or older.",
    checkHealth: "I do not have end-stage kidney disease, and I am not on dialysis.",
    checkAgree: "I have read the information above and I agree to take part.",
    accept: "I agree — continue",
    decline: "No thanks",
  },
  assessment: {
    eyebrow: "Kidney health screening",
    title: "Risk assessment",
    subtitle: "Take your time. Answer one question at a time.",
    step: (n, total) => `Question ${n} of ${total}`,
    notice: "This screening is for informational purposes only and does not provide a medical diagnosis. If a statement does not apply to you or you are unsure of your answer, select “No.” This screening is not a substitute for professional medical advice, evaluation, or diagnosis. Always consult your healthcare provider for medical guidance.",
    explainButton: "Explain this question",
    explainChip: "Can you explain this question in simple words?",
    answerLabel: "Your answer",
    answerOrAskLabel: "Type an answer or ask a question",
    numberPlaceholder: "Type your answer (a number)…",
    textPlaceholder: "Type your answer, or ask about the question…",
    send: "Send",
    you: "You",
    bato: "BATO",
    unavailableTitle: "Assessment unavailable",
    tryAgain: "Try again",
    somethingWrong: "Something went wrong. Please try again.",
  },
  questions: {
    age: "To get started: how old are you? Please type your age in years (for example, 54).",
    female: "What sex were you assigned at birth? This matters because kidney disease risk differs between males and females.",
    anemia: "Has a doctor or health worker ever told you that you have anemia — that is, a low red blood cell count?",
    hypertension: "Do you have high blood pressure (hypertension), or do you take medicine to keep your blood pressure down?",
    diabetes: "Have you been diagnosed with diabetes (high blood sugar)?",
    cvd_history: "Have you ever had a heart attack or a stroke?",
    chf_history: "Has a doctor ever told you that you have heart failure (also called congestive heart failure)?",
    pvd: "Has a doctor ever told you that you have poor blood circulation in your legs (peripheral vascular disease)?",
    proteinuria: "Has a urine test ever shown that you have protein in your urine? If you've never been told this, answer \"not sure\".",
  },
  options: { Yes: "Yes", No: "No", "Not sure": "Not sure", Male: "Male", Female: "Female" },
  // English shows the server's own message; this is only a fallback.
  invalid: () => "Please try that answer again.",
  results: {
    eyebrow: "Assessment complete",
    disclaimerTitle: "This is a screening result, not a diagnosis",
    disclaimerBody: "BATO is a screening tool, not a clinical diagnostic instrument. Your result is based only on your own answers, so it cannot confirm or rule out kidney disease. Only laboratory tests reviewed by a health professional can.",
    scoreLabel: "SCORED score",
    positiveTitle: "Screening suggests elevated risk",
    positiveBody: "Your answers add up to a score that the SCORED tool classifies as Screen Positive. People with answers like yours have a higher chance of reduced kidney function. This is not a diagnosis.",
    positiveNextTitle: "Please see a health professional",
    positiveNext: "Visit a doctor or health center for a confirmatory kidney check — usually a blood test (creatinine/eGFR) and a urine test. Early detection makes a real difference.",
    findLab: "Find a nearby clinical laboratory",
    confirmLab: "For the blood test, confirm test availability with the facility first.",
    negativeTitle: "Screening did not suggest elevated risk",
    negativeBody: "Your answers add up to a score that the SCORED tool classifies as Screen Negative.",
    negativeWarningTitle: "A low score is not a guarantee",
    negativeWarning: "A Screen Negative result does not mean you are free of kidney disease. Kidney disease often has no symptoms, and this screening can miss it — especially if you have never had your blood pressure, blood sugar or urine checked. Routine medical check-ups remain essential.",
    negativeNextTitle: "What to do next",
    negativeNext: "Keep up regular check-ups with a doctor or health center, manage your blood pressure and blood sugar, and ask the Kidney Health Chat how to protect your kidneys.",
    accuracyTitle: "How accurate is this?",
    accuracyBody: "The score is computed by fixed, published medical rules (SCORED — Bang et al., 2007), not by AI. Screening tools estimate risk: they can miss cases and can flag people who turn out fine.",
    retake: "Retake the assessment",
    askChat: "Ask about kidney health",
  },
  chat: {
    eyebrow: "KIDNEY HEALTH GUIDE",
    title: "Ask about kidney health",
    subtitle: "Clear answers to general questions, grounded in trusted health sources.",
    badge: "AI chatbot",
    notice: "This is an AI-powered chatbot. Its answers come from trusted health sources, but it can make mistakes. Do not use it to make medical decisions — talk to a doctor. Please do not type your name or other personal details.",
    emptyTitle: "What would you like to know?",
    emptyLead: "Explore kidney conditions, tests, medicines, prevention, and kidney care in the Philippines.",
    tryQuestion: "Try a question",
    inputLabel: "Your kidney health question",
    placeholder: "Type your question…",
    send: "Send",
    you: "You",
    bato: "BATO",
    sources: "Sources",
    replying: "BATO is replying",
    somethingWrong: "Something went wrong. Please try again.",
  },
  feedback: {
    eyebrow: "SHARE YOUR EXPERIENCE",
    title: "Tell us what you think",
    body: "Finished the screening and the Kidney chat? Please answer our short feedback form. It has three short surveys and takes about 10 minutes.",
    button: "Open the feedback form",
    newTab: "Opens Google Forms in a new tab.",
    unavailable: "The feedback form is not ready yet. Please ask the researcher.",
    thanks: "Thank you for helping our research!",
  },
};

const fil: Strings = {
  nav: { assessment: "Pagsusuri", chat: "Kidney chat", labs: "Hanapin ang lab", feedback: "Puna" },
  languageLabel: "Wika",
  footer: {
    lead: "Para sa kaalaman, hindi para sa diagnosis.",
    body: "Ang BATO ay screening tool, hindi medical device. Ang mga resulta at sagot ng chat ay hindi payong medikal. Kumonsulta sa isang health professional tungkol sa iyong kalusugan. Ginagamit ang SCORED nang may lisensya mula sa AstraZeneca Philippines (PH-6850).",
  },
  consent: {
    eyebrow: "Bago magsimula",
    title: "Pakibasa muna ito",
    intro: "Ang BATO ay isang research project ng College of Computer Studies, University of the Immaculate Conception, Davao City. Sinusuri nito ang iyong panganib sa Chronic Kidney Disease (CKD) gamit ang SCORED questionnaire. Isa lamang itong screening tool: hindi ito nagda-diagnose ng anumang sakit at hindi nito pinapalitan ang doktor.",
    aiTitle: "Gagamit ka ng chatbot na pinapagana ng AI",
    aiBody: "Ang mga sagot ng chat ng BATO, at ang mga paliwanag nito sa mga tanong sa screening, ay isinusulat ng artificial intelligence (AI) gamit ang mapagkakatiwalaang mga health source. Maaaring magkamali ang AI o may makaligtaan. Huwag itong gamitin sa paggawa ng mga desisyong medikal. Kumausap ng doktor.",
    dataTitle: "Ano ang nangyayari sa iyong impormasyon",
    dataItems: [
      "Hindi kailangan ng pangalan, email, o account. Anonymous ang iyong session.",
      "Binubura ang iyong mga sagot sa screening at ang resulta sa sandaling maipakita ang iyong resulta. Hindi ito iniimbak ng BATO.",
      "Ang mga tanong na isinusulat mo sa mga chatbot ng BATO, at ang mga sagot ng BATO, ay iniimbak nang walang pangalan mo upang matiyak ng research team na tama ang impormasyon. Ang research team lamang ang makakakita nito.",
      "Para masagot ka, ipinapadala ang mga tanong na isinusulat mo sa mga online AI service (Google Gemini, Groq, at Cohere) sa pamamagitan ng host ng BATO, ang Supabase. Hinahawakan ng mga kompanyang ito ang mga tanong ayon sa sarili nilang mga patakaran. Huwag isulat ang iyong pangalan, contact details, o anumang impormasyong maaaring makapagpakilala sa iyo.",
      "Nasa Google Forms ang mga feedback survey, kaya natatanggap ng Google ang mga sagot na pipiliin mong isumite. Iniimbak ito ng research team para sa ebalwasyon ng pag-aaral.",
    ],
    voluntary: "Kusang-loob ang pakikilahok. Maaari kang magpahinga o tumigil anumang oras nang walang anumang parusa. Maaari kang magtanong sa mga mananaliksik anumang oras.",
    checkAge: "Ako ay 20 taong gulang o higit pa.",
    checkHealth: "Wala akong end-stage kidney disease, at hindi ako nagda-dialysis.",
    checkAgree: "Nabasa ko ang impormasyon sa itaas at pumapayag akong makilahok.",
    accept: "Pumapayag ako — magpatuloy",
    decline: "Huwag na lang",
  },
  assessment: {
    eyebrow: "Screening sa kalusugan ng bato",
    title: "Pagsusuri ng panganib",
    subtitle: "Huwag magmadali. Sagutin ang isang tanong sa bawat pagkakataon.",
    step: (n, total) => `Tanong ${n} sa ${total}`,
    notice: "Ang screening na ito ay para sa impormasyon lamang at hindi nagbibigay ng medikal na diagnosis. Kung hindi angkop sa iyo ang isang pahayag o hindi ka sigurado sa iyong sagot, piliin ang “Hindi.” Hindi kapalit ang screening na ito ng propesyonal na payo, pagsusuri, o diagnosis medikal. Laging kumonsulta sa iyong healthcare provider para sa gabay medikal.",
    explainButton: "Ipaliwanag ang tanong",
    explainChip: "Maaari mo bang ipaliwanag ang tanong na ito sa simpleng salita?",
    answerLabel: "Ang iyong sagot",
    answerOrAskLabel: "Isulat ang sagot o magtanong",
    numberPlaceholder: "Isulat ang iyong sagot (numero)…",
    textPlaceholder: "Isulat ang iyong sagot, o magtanong tungkol sa tanong…",
    send: "Ipadala",
    you: "Ikaw",
    bato: "BATO",
    unavailableTitle: "Hindi magamit ang pagsusuri",
    tryAgain: "Subukan muli",
    somethingWrong: "May nangyaring mali. Pakisubukan muli.",
  },
  questions: {
    age: "Para magsimula: ilang taon ka na? Pakisulat ang iyong edad sa bilang (halimbawa, 54).",
    female: "Ano ang iyong kasarian noong ipinanganak ka? Mahalaga ito dahil magkaiba ang panganib sa sakit sa bato ng mga lalaki at babae.",
    anemia: "Sinabi na ba sa iyo ng doktor o health worker na mayroon kang anemia — ibig sabihin, mababa ang bilang ng iyong red blood cells?",
    hypertension: "Mayroon ka bang high blood pressure (altapresyon), o umiinom ka ba ng gamot para mapababa ang iyong blood pressure?",
    diabetes: "Na-diagnose ka na ba na may diabetes (mataas na asukal sa dugo)?",
    cvd_history: "Nagkaroon ka na ba ng atake sa puso (heart attack) o stroke?",
    chf_history: "Sinabi na ba sa iyo ng doktor na mayroon kang heart failure (tinatawag ding congestive heart failure)?",
    pvd: "Sinabi na ba sa iyo ng doktor na mahina ang daloy ng dugo sa iyong mga binti (peripheral vascular disease)?",
    proteinuria: "Nakita na ba sa isang urine test (pagsusuri ng ihi) na may protina ang iyong ihi? Kung hindi pa ito nasasabi sa iyo, sagutin ang \"Hindi sigurado\".",
  },
  options: { Yes: "Oo", No: "Hindi", "Not sure": "Hindi sigurado", Male: "Lalaki", Female: "Babae" },
  invalid: (code) => ({
    age_format: "Pakisulat ang iyong edad bilang buong numero, halimbawa 54.",
    age_range: "Mukhang hindi tama ang edad na iyan. Maglagay ng numero mula 1 hanggang 120.",
    age_under_min: "Ang screening ng BATO ay para sa mga nasa hustong gulang na 20 taon pataas. Kung nagkamali ka sa pagsulat ng edad, pakisulat itong muli.",
    sex: "Pakisagot ng \"Lalaki\" o \"Babae\" (kasarian noong ipinanganak).",
    yes_no: "Pakisagot ng \"Oo\" o \"Hindi\". Kung hindi mo naiintindihan ang tanong, maaari mo akong hilingin na ipaliwanag ito.",
    unsure: "Kung hindi mo alam kung sinabi na ito sa iyo ng doktor o health worker, sumagot ng \"Hindi\". Ang hindi siguradong sagot ay itinuturing na \"Hindi\" sa screening na ito. Kung hindi mo naiintindihan ang tanong, hilingin sa akin na ipaliwanag ito.",
    unsure_recall: "Kung hindi mo matandaan na sinabi ito sa iyo ng doktor o health worker, sumagot ng \"Hindi\". Ang hindi siguradong sagot ay itinuturing na \"Hindi\" sa screening na ito. Kung hindi mo naiintindihan ang tanong, hilingin sa akin na ipaliwanag ito.",
    yes_no_unsure: "Pakisagot ng \"Oo\", \"Hindi\", o \"Hindi sigurado\".",
  })[code],
  results: {
    eyebrow: "Tapos na ang pagsusuri",
    disclaimerTitle: "Ito ay resulta ng screening, hindi diagnosis",
    disclaimerBody: "Ang BATO ay screening tool, hindi instrumento para sa clinical diagnosis. Ang iyong resulta ay batay lamang sa sarili mong mga sagot, kaya hindi nito makukumpirma o maaalis ang posibilidad ng sakit sa bato. Mga laboratory test lamang na sinuri ng isang health professional ang makagagawa nito.",
    scoreLabel: "SCORED score",
    positiveTitle: "Nagpapakita ang screening ng mas mataas na panganib",
    positiveBody: "Ang kabuuan ng iyong mga sagot ay isang score na inuuri ng SCORED tool bilang Screen Positive. Ang mga taong may sagot na tulad ng sa iyo ay may mas mataas na posibilidad na humina ang paggana ng bato. Hindi ito diagnosis.",
    positiveNextTitle: "Pakikonsulta sa isang health professional",
    positiveNext: "Pumunta sa doktor o health center para sa kumpirmasyong pagsusuri ng bato — kadalasan ay blood test (creatinine/eGFR) at urine test. Malaking tulong ang maagang pagtuklas.",
    findLab: "Maghanap ng malapit na clinical laboratory",
    confirmLab: "Para sa blood test, alamin muna sa pasilidad kung mayroon silang test na ito.",
    negativeTitle: "Hindi nagpakita ang screening ng mas mataas na panganib",
    negativeBody: "Ang kabuuan ng iyong mga sagot ay isang score na inuuri ng SCORED tool bilang Screen Negative.",
    negativeWarningTitle: "Hindi garantiya ang mababang score",
    negativeWarning: "Ang Screen Negative na resulta ay hindi nangangahulugang wala kang sakit sa bato. Kadalasang walang sintomas ang sakit sa bato, at maaari itong hindi matukoy ng screening na ito — lalo na kung hindi pa nasusuri ang iyong blood pressure, blood sugar, o ihi. Mahalaga pa rin ang regular na medical check-up.",
    negativeNextTitle: "Ano ang susunod na gagawin",
    negativeNext: "Magpatuloy sa regular na check-up sa doktor o health center, bantayan ang iyong blood pressure at blood sugar, at magtanong sa Kidney Health Chat kung paano pangalagaan ang iyong mga bato.",
    accuracyTitle: "Gaano ito katumpak?",
    accuracyBody: "Kinukuwenta ang score gamit ang nakapirming nailathalang mga panuntunang medikal (SCORED — Bang et al., 2007), hindi ng AI. Tinatantya lamang ng mga screening tool ang panganib: maaari silang makaligta ng kaso at maaaring mag-flag ng mga taong wala namang sakit.",
    retake: "Ulitin ang pagsusuri",
    askChat: "Magtanong tungkol sa kalusugan ng bato",
  },
  chat: {
    eyebrow: "GABAY SA KALUSUGAN NG BATO",
    title: "Magtanong tungkol sa kalusugan ng bato",
    subtitle: "Malinaw na sagot sa mga pangkalahatang tanong, batay sa mapagkakatiwalaang mga health source.",
    badge: "AI chatbot",
    notice: "Ito ay chatbot na pinapagana ng AI. Galing sa mapagkakatiwalaang mga health source ang mga sagot nito, pero maaari itong magkamali. Huwag itong gamitin sa paggawa ng mga desisyong medikal — kumausap ng doktor. Huwag isulat ang iyong pangalan o iba pang personal na detalye. Nasa Ingles ang mga sagot.",
    emptyTitle: "Ano ang gusto mong malaman?",
    emptyLead: "Alamin ang tungkol sa mga kondisyon ng bato, mga test, gamot, pag-iwas, at pangangalaga sa bato sa Pilipinas.",
    tryQuestion: "Subukan ang isang tanong",
    inputLabel: "Ang iyong tanong tungkol sa kalusugan ng bato",
    placeholder: "Isulat ang iyong tanong…",
    send: "Ipadala",
    you: "Ikaw",
    bato: "BATO",
    sources: "Mga source",
    replying: "Sumasagot ang BATO",
    somethingWrong: "May nangyaring mali. Pakisubukan muli.",
  },
  feedback: {
    eyebrow: "IBAHAGI ANG IYONG KARANASAN",
    title: "Ano ang masasabi mo?",
    body: "Natapos mo na ba ang screening at ang Kidney chat? Pakisagutan ang aming maikling feedback form. Mayroon itong tatlong maikling survey at aabutin ng mga 10 minuto.",
    button: "Buksan ang feedback form",
    newTab: "Magbubukas ang Google Forms sa bagong tab.",
    unavailable: "Hindi pa handa ang feedback form. Pakitanong sa researcher.",
    thanks: "Salamat sa pagtulong sa aming pag-aaral!",
  },
};

const ceb: Strings = {
  nav: { assessment: "Pagsusi", chat: "Kidney chat", labs: "Pangitag lab", feedback: "Komento" },
  languageLabel: "Pinulongan",
  footer: {
    lead: "Para sa kahibalo, dili para sa diagnosis.",
    body: "Ang BATO usa ka screening tool, dili medical device. Ang mga resulta ug tubag sa chat dili tambag medikal. Pakonsulta sa usa ka health professional bahin sa imong panglawas. Gigamit ang SCORED uban ang lisensya gikan sa AstraZeneca Philippines (PH-6850).",
  },
  consent: {
    eyebrow: "Sa dili pa magsugod",
    title: "Palihug basaha una kini",
    intro: "Ang BATO usa ka research project sa College of Computer Studies, University of the Immaculate Conception, Davao City. Gisusi niini ang imong risgo sa Chronic Kidney Disease (CKD) gamit ang SCORED questionnaire. Usa lang kini ka screening tool: dili kini modiagnose og bisan unsang sakit ug dili kini puli sa doktor.",
    aiTitle: "Mogamit ka og chatbot nga gipaandar sa AI",
    aiBody: "Ang mga tubag sa chat sa BATO, ug ang mga pagpasabot niini sa mga pangutana sa screening, gisulat sa artificial intelligence (AI) gamit ang kasaligang mga health source. Mahimong masayop ang AI o naay masipyat. Ayaw kini gamita sa paghimo og mga desisyon medikal. Pakigsulti sa doktor.",
    dataTitle: "Unsay mahitabo sa imong impormasyon",
    dataItems: [
      "Dili kinahanglan ang ngalan, email, o account. Anonymous ang imong session.",
      "Papason ang imong mga tubag sa screening ug ang resulta dayon human ipakita ang imong resulta. Dili kini tipigan sa BATO.",
      "Ang mga pangutana nga imong isulat sa mga chatbot sa BATO, ug ang mga tubag sa BATO, tipigan nga walay imong ngalan aron masusi sa research team nga sakto ang impormasyon. Ang research team lang ang makakita niini.",
      "Aron ka matubag, ipadala ang mga pangutana nga imong isulat ngadto sa mga online AI service (Google Gemini, Groq, ug Cohere) pinaagi sa host sa BATO, ang Supabase. Kini nga mga kompanya modumala sa mga pangutana sumala sa ilang kaugalingong mga lagda. Ayaw isulat ang imong ngalan, contact details, o bisan unsang impormasyon nga makaila kanimo.",
      "Ang mga feedback survey anaa sa Google Forms, busa madawat sa Google ang mga tubag nga imong pilion nga isumite. Tipigan kini sa research team alang sa ebalwasyon sa pagtuon.",
    ],
    voluntary: "Boluntaryo ang pag-apil. Mahimo kang mopahulay o mohunong bisan kanus-a nga walay bisan unsang silot. Mahimo kang mangutana sa mga tigdukiduki bisan kanus-a.",
    checkAge: "Ako 20 anyos o labaw pa.",
    checkHealth: "Wala koy end-stage kidney disease, ug wala ko nagpa-dialysis.",
    checkAgree: "Nabasa nako ang impormasyon sa ibabaw ug mouyon ko nga moapil.",
    accept: "Mouyon ko — padayon",
    decline: "Dili na lang",
  },
  assessment: {
    eyebrow: "Screening sa panglawas sa kidney",
    title: "Pagsusi sa risgo",
    subtitle: "Ayaw pagdali. Tubaga ang usa ka pangutana matag higayon.",
    step: (n, total) => `Pangutana ${n} sa ${total}`,
    notice: "Kini nga screening alang lamang sa impormasyon ug dili mohatag og medikal nga diagnosis. Kung dili angay kanimo ang usa ka pahayag o dili ka sigurado sa imong tubag, pilia ang “Dili.” Kini nga screening dili puli sa propesyonal nga tambag, pagsusi, o diagnosis medikal. Kanunay pakonsulta sa imong healthcare provider alang sa giya medikal.",
    explainButton: "Ipasabot ang pangutana",
    explainChip: "Mahimo ba nimong ipasabot kini nga pangutana sa yanong pulong?",
    answerLabel: "Imong tubag",
    answerOrAskLabel: "Isulat ang tubag o pangutana",
    numberPlaceholder: "Isulat ang imong tubag (numero)…",
    textPlaceholder: "Isulat ang imong tubag, o pangutana bahin sa pangutana…",
    send: "Ipadala",
    you: "Ikaw",
    bato: "BATO",
    unavailableTitle: "Dili magamit ang pagsusi",
    tryAgain: "Sulayi pag-usab",
    somethingWrong: "Naay sayop nga nahitabo. Palihug sulayi pag-usab.",
  },
  questions: {
    age: "Aron magsugod: pila na ang imong edad? Palihug isulat ang imong edad sa numero (pananglitan, 54).",
    female: "Unsa ang imong sekso sa pagkatawo? Importante kini kay lahi ang risgo sa sakit sa kidney sa mga lalaki ug babaye.",
    anemia: "Gisultihan na ba ka sa doktor o health worker nga naa kay anemia — buot ipasabot, ubos ang ihap sa imong red blood cells?",
    hypertension: "Naa ba kay high blood pressure (hypertension), o nag-inom ka ba og tambal aron mopaubos sa imong blood pressure?",
    diabetes: "Na-diagnose na ba ka nga naa kay diabetes (taas nga asukar sa dugo)?",
    cvd_history: "Na-heart attack o na-stroke na ba ka?",
    chf_history: "Gisultihan na ba ka sa doktor nga naa kay heart failure (gitawag usab nga congestive heart failure)?",
    pvd: "Gisultihan na ba ka sa doktor nga huyang ang dagan sa dugo sa imong mga tiil (peripheral vascular disease)?",
    proteinuria: "Nakita na ba sa usa ka urine test (pagsusi sa ihi) nga naay protina ang imong ihi? Kung wala pa kini isulti kanimo, tubaga og \"Dili sigurado\".",
  },
  options: { Yes: "Oo", No: "Dili", "Not sure": "Dili sigurado", Male: "Lalaki", Female: "Babaye" },
  invalid: (code) => ({
    age_format: "Palihug isulat ang imong edad isip tibuok numero, pananglitan 54.",
    age_range: "Morag dili sakto kana nga edad. Palihug pagbutang og numero gikan 1 hangtod 120.",
    age_under_min: "Ang screening sa BATO para sa mga hamtong nga 20 anyos pataas. Kung nasayop ka sa pagsulat sa imong edad, palihug isulat kini pag-usab.",
    sex: "Palihug tubaga og \"Lalaki\" o \"Babaye\" (sekso sa pagkatawo).",
    yes_no: "Palihug tubaga og \"Oo\" o \"Dili\". Kung wala nimo masabti ang pangutana, mahimo nimo kong hangyoon nga ipasabot kini.",
    unsure: "Kung wala ka kahibalo kung gisultihan na ba ka niini sa doktor o health worker, tubaga og \"Dili\". Ang dili sigurado nga tubag giihap nga \"Dili\" niini nga screening. Kung wala nimo masabti ang pangutana, hangyoa ko nga ipasabot kini.",
    unsure_recall: "Kung dili nimo mahinumdoman nga gisultihan ka niini sa doktor o health worker, tubaga og \"Dili\". Ang dili sigurado nga tubag giihap nga \"Dili\" niini nga screening. Kung wala nimo masabti ang pangutana, hangyoa ko nga ipasabot kini.",
    yes_no_unsure: "Palihug tubaga og \"Oo\", \"Dili\", o \"Dili sigurado\".",
  })[code],
  results: {
    eyebrow: "Nahuman na ang pagsusi",
    disclaimerTitle: "Kini resulta sa screening, dili diagnosis",
    disclaimerBody: "Ang BATO usa ka screening tool, dili instrumento para sa clinical diagnosis. Ang imong resulta gibase lang sa imong kaugalingong mga tubag, busa dili niini makumpirma o mawala ang posibilidad sa sakit sa kidney. Mga laboratory test lang nga gisusi sa usa ka health professional ang makahimo niini.",
    scoreLabel: "SCORED score",
    positiveTitle: "Nagpakita ang screening og mas taas nga risgo",
    positiveBody: "Ang kinatibuk-an sa imong mga tubag usa ka score nga giklasipikar sa SCORED tool isip Screen Positive. Ang mga tawo nga naay tubag sama sa imo naay mas taas nga posibilidad nga mohuyang ang paglihok sa kidney. Dili kini diagnosis.",
    positiveNextTitle: "Palihug pakonsulta sa usa ka health professional",
    positiveNext: "Adto sa doktor o health center para sa pagkumpirma nga pagsusi sa kidney — kasagaran blood test (creatinine/eGFR) ug urine test. Dako kaayo og tabang ang sayo nga pagkakita.",
    findLab: "Pangitag duol nga clinical laboratory",
    confirmLab: "Para sa blood test, pangutan-a una ang pasilidad kung naa ba silay ingon niini nga test.",
    negativeTitle: "Wala magpakita ang screening og mas taas nga risgo",
    negativeBody: "Ang kinatibuk-an sa imong mga tubag usa ka score nga giklasipikar sa SCORED tool isip Screen Negative.",
    negativeWarningTitle: "Dili garantiya ang ubos nga score",
    negativeWarning: "Ang Screen Negative nga resulta wala magpasabot nga wala kay sakit sa kidney. Kasagaran walay sintomas ang sakit sa kidney, ug mahimong dili kini makit-an niini nga screening — labi na kung wala pa masusi ang imong blood pressure, blood sugar, o ihi. Importante gihapon ang regular nga medical check-up.",
    negativeNextTitle: "Unsay sunod nga buhaton",
    negativeNext: "Padayon sa regular nga check-up sa doktor o health center, bantayi ang imong blood pressure ug blood sugar, ug pangutana sa Kidney Health Chat kung unsaon pag-atiman sa imong mga kidney.",
    accuracyTitle: "Unsa ka sakto kini?",
    accuracyBody: "Ang score gikuwenta gamit ang piho ug napatik nga mga lagda medikal (SCORED — Bang et al., 2007), dili sa AI. Gibanabana lang sa mga screening tool ang risgo: mahimong masipyat sila og kaso ug mahimong ma-flag ang mga tawo nga wala diay sakit.",
    retake: "Usba ang pagsusi",
    askChat: "Pangutana bahin sa panglawas sa kidney",
  },
  chat: {
    eyebrow: "GIYA SA PANGLAWAS SA KIDNEY",
    title: "Pangutana bahin sa panglawas sa kidney",
    subtitle: "Klarong tubag sa kinatibuk-ang mga pangutana, gibase sa kasaligang mga health source.",
    badge: "AI chatbot",
    notice: "Kini usa ka chatbot nga gipaandar sa AI. Gikan sa kasaligang mga health source ang mga tubag niini, pero mahimo kining masayop. Ayaw kini gamita sa paghimo og mga desisyon medikal — pakigsulti sa doktor. Ayaw isulat ang imong ngalan o ubang personal nga detalye. Naa sa English ang mga tubag.",
    emptyTitle: "Unsay gusto nimong mahibaloan?",
    emptyLead: "Susiha ang mga kondisyon sa kidney, mga test, tambal, paglikay, ug pag-atiman sa kidney sa Pilipinas.",
    tryQuestion: "Sulayi ang usa ka pangutana",
    inputLabel: "Imong pangutana bahin sa panglawas sa kidney",
    placeholder: "Isulat ang imong pangutana…",
    send: "Ipadala",
    you: "Ikaw",
    bato: "BATO",
    sources: "Mga source",
    replying: "Nagtubag ang BATO",
    somethingWrong: "Naay sayop nga nahitabo. Palihug sulayi pag-usab.",
  },
  feedback: {
    eyebrow: "SHARE YOUR EXPERIENCE",
    title: "Tell us what you think",
    body: "Tapos na ba nimo ang screening ug ang Kidney chat? Palihug tubaga ang among mubo nga feedback form. Kini adunay tulo ka mubo nga survey ug mokabat og mga 10 minutos.",
    button: "Ablihi ang feedback form",
    newTab: "Moabli sa Google Forms sa bag-ong tab.",
    unavailable: "Wala pa maandam ang feedback form. Palihug pangutan-a ang researcher.",
    thanks: "Salamat sa pagtabang sa among pagtuon!",
  },
};

export const STRINGS: Record<Lang, Strings> = { en, fil, ceb };
