// ACC-213 — every visible word on the website, in English and Arabic.
//
// THIS IS SCAFFOLD COPY. Everything marked DRAFT is a placeholder for the
// structure only: no product claims, prices, customer names or testimonials.
// The real copy comes from the accepted design
// (frontend/design-reference/AccreditMe Website.dc.html) in a later step.
// The wordmark "AccreditMe" stays in Latin letters in both languages.

export type Lang = 'en' | 'ar';

/** The 12 sections, in the design's order, each on the design's band. */
export type Band = 'hero' | 'tint-grey' | 'tint-sky' | 'white' | 'charcoal';

export interface SectionCopy {
  id: string;
  band: Band;
  title: string;
  note: string;
}

export interface Strings {
  dir: 'ltr' | 'rtl';
  draft: string;
  skipToContent: string;
  logoAlt: string;
  nav: { label: string; problem: string; whatItDoes: string; pricing: string; faq: string; demo: string };
  languageSwitch: { label: string; otherName: string; otherLang: Lang };
  signIn: {
    title: string;
    label: string;
    help: string;
    suffix: string;
    continue: string;
    errors: { empty: string; format: string; reserved: string };
  };
  home: { title: string; description: string; sections: SectionCopy[] };
  demoForm: {
    title: string;
    name: string;
    email: string;
    organisation: string;
    country: string;
    phone: string;
    phoneOptional: string;
    message: string;
    submit: string;
    comingSoon: string;
    errors: { required: string; email: string; tooLong: string };
  };
  footer: { legal: string; privacy: string; terms: string; copyright: string };
  privacy: { title: string; description: string; body: string };
  terms: { title: string; description: string; body: string };
  notFound: { title: string; description: string; body: string; home: string };
}

export const strings: Record<Lang, Strings> = {
  en: {
    dir: 'ltr',
    draft: 'DRAFT',
    skipToContent: 'Skip to content',
    logoAlt: 'AccreditMe',
    nav: {
      label: 'Sections',
      problem: 'The problem',
      whatItDoes: 'What it does',
      pricing: 'Pricing',
      faq: 'FAQ',
      demo: 'Request a demo',
    },
    languageSwitch: { label: 'Language', otherName: 'العربية', otherLang: 'ar' },
    signIn: {
      title: 'Sign in',
      label: 'Your organisation’s address',
      help: 'The name before .accreditme.app, for example your-organisation.',
      suffix: '.accreditme.app',
      continue: 'Continue',
      errors: {
        empty: 'Enter your organisation’s address.',
        format: 'Use lowercase letters, numbers and hyphens only, up to 63 characters, not starting or ending with a hyphen.',
        reserved: 'That name isn’t an organisation’s address. Check the address you were given.',
      },
    },
    home: {
      title: 'AccreditMe — DRAFT',
      description: 'DRAFT placeholder. The website’s copy is not written yet.',
      sections: [
        { id: 'hero', band: 'hero', title: 'Hero', note: 'Placeholder for the value promise, one supporting line and the two calls to action.' },
        { id: 'problem', band: 'tint-grey', title: 'The problem', note: 'Placeholder for what quality and accreditation work looks like today.' },
        { id: 'what-it-does', band: 'white', title: 'What it does', note: 'Placeholder for the quality cycle and where each part of the platform sits on it.' },
        { id: 'how-it-works', band: 'white', title: 'How it works', note: 'Placeholder for how the cycle runs in an organisation, step by step.' },
        { id: 'ai', band: 'white', title: 'AI that assists', note: 'Placeholder for how AI suggests and a person decides.' },
        { id: 'security', band: 'white', title: 'Security and data', note: 'Placeholder for how each organisation’s data is kept and traced.' },
        { id: 'who', band: 'tint-sky', title: 'Who it’s for', note: 'Placeholder for the people and sectors the platform is built for.' },
        { id: 'pricing', band: 'charcoal', title: 'Pricing', note: 'Placeholder. Plans and prices come from the platform later; none are shown here.' },
        { id: 'faq', band: 'white', title: 'FAQ', note: 'Placeholder for common questions and their answers.' },
        { id: 'demo', band: 'charcoal', title: 'Request a demo', note: 'Placeholder for the final call to action. The form below is not connected yet.' },
      ],
    },
    demoForm: {
      title: 'Demo request form',
      name: 'Your name',
      email: 'Work email',
      organisation: 'Organisation',
      country: 'Country',
      phone: 'Phone',
      phoneOptional: '(optional)',
      message: 'What would you like to see?',
      submit: 'Send request',
      comingSoon: 'Coming soon: this form is not connected yet, so nothing is sent.',
      errors: {
        required: 'This field is required.',
        email: 'Enter an email address, like name@example.org.',
        tooLong: 'This is too long.',
      },
    },
    footer: { legal: 'Legal', privacy: 'Privacy policy', terms: 'Terms of service', copyright: '© [Company name]' },
    privacy: {
      title: 'Privacy policy — DRAFT',
      description: 'DRAFT placeholder for the privacy policy.',
      body: 'This page is a placeholder. The privacy policy has not been written or reviewed yet, and nothing here applies.',
    },
    terms: {
      title: 'Terms of service — DRAFT',
      description: 'DRAFT placeholder for the terms of service.',
      body: 'This page is a placeholder. The terms of service have not been written or reviewed yet, and nothing here applies.',
    },
    notFound: {
      title: 'Page not found',
      description: 'This page doesn’t exist.',
      body: 'There is no page at this address.',
      home: 'Go to the home page',
    },
  },
  ar: {
    dir: 'rtl',
    draft: 'مسودة',
    skipToContent: 'انتقل إلى المحتوى',
    logoAlt: 'AccreditMe',
    nav: {
      label: 'الأقسام',
      problem: 'المشكلة',
      whatItDoes: 'ما الذي يقدمه',
      pricing: 'الأسعار',
      faq: 'أسئلة شائعة',
      demo: 'اطلب عرضًا توضيحيًا',
    },
    languageSwitch: { label: 'اللغة', otherName: 'English', otherLang: 'en' },
    signIn: {
      title: 'تسجيل الدخول',
      label: 'عنوان مؤسستك',
      help: 'الاسم الذي يسبق accreditme.app في العنوان، مثل your-organisation.',
      suffix: '.accreditme.app',
      continue: 'متابعة',
      errors: {
        empty: 'أدخل عنوان مؤسستك.',
        format: 'استخدم أحرفًا إنجليزية صغيرة وأرقامًا وشرطات فقط، حتى 63 حرفًا، دون أن يبدأ العنوان أو ينتهي بشرطة.',
        reserved: 'هذا الاسم ليس عنوان مؤسسة. تحقّق من العنوان الذي أُعطي لك.',
      },
    },
    home: {
      title: 'AccreditMe — مسودة',
      description: 'نص مؤقت (مسودة). لم يُكتب محتوى الموقع بعد.',
      sections: [
        { id: 'hero', band: 'hero', title: 'الواجهة الرئيسية', note: 'مكان مؤقت للوعد بالقيمة وسطر داعم وزرَّي الإجراء.' },
        { id: 'problem', band: 'tint-grey', title: 'المشكلة', note: 'مكان مؤقت لوصف عمل الجودة والاعتماد اليوم.' },
        { id: 'what-it-does', band: 'white', title: 'ما الذي يقدمه', note: 'مكان مؤقت لدورة الجودة وموقع كل جزء من المنصة فيها.' },
        { id: 'how-it-works', band: 'white', title: 'كيف يعمل', note: 'مكان مؤقت لسير الدورة في المؤسسة خطوة بخطوة.' },
        { id: 'ai', band: 'white', title: 'ذكاء اصطناعي يساعد', note: 'مكان مؤقت لكيف يقترح الذكاء الاصطناعي ويقرر الإنسان.' },
        { id: 'security', band: 'white', title: 'الأمان والبيانات', note: 'مكان مؤقت لكيف تُحفظ بيانات كل مؤسسة ويُتتبَّع أثرها.' },
        { id: 'who', band: 'tint-sky', title: 'لمن هو', note: 'مكان مؤقت للأشخاص والقطاعات التي صُممت المنصة لها.' },
        { id: 'pricing', band: 'charcoal', title: 'الأسعار', note: 'مكان مؤقت. الخطط والأسعار تأتي من المنصة لاحقًا، ولا يُعرض منها شيء هنا.' },
        { id: 'faq', band: 'white', title: 'أسئلة شائعة', note: 'مكان مؤقت للأسئلة الشائعة وإجاباتها.' },
        { id: 'demo', band: 'charcoal', title: 'اطلب عرضًا توضيحيًا', note: 'مكان مؤقت لدعوة الإجراء الأخيرة. النموذج أدناه غير متصل بعد.' },
      ],
    },
    demoForm: {
      title: 'نموذج طلب عرض توضيحي',
      name: 'اسمك',
      email: 'البريد الإلكتروني للعمل',
      organisation: 'المؤسسة',
      country: 'الدولة',
      phone: 'الهاتف',
      phoneOptional: '(اختياري)',
      message: 'ما الذي تودّ رؤيته؟',
      submit: 'إرسال الطلب',
      comingSoon: 'قريبًا: هذا النموذج غير متصل بعد، فلا يُرسَل شيء.',
      errors: {
        required: 'هذا الحقل مطلوب.',
        email: 'أدخل بريدًا إلكترونيًا، مثل name@example.org.',
        tooLong: 'النص طويل جدًا.',
      },
    },
    footer: { legal: 'قانوني', privacy: 'سياسة الخصوصية', terms: 'شروط الخدمة', copyright: '© [اسم الشركة]' },
    privacy: {
      title: 'سياسة الخصوصية — مسودة',
      description: 'مكان مؤقت (مسودة) لسياسة الخصوصية.',
      body: 'هذه الصفحة مؤقتة. لم تُكتب سياسة الخصوصية ولم تُراجَع بعد، ولا ينطبق شيء مما هنا.',
    },
    terms: {
      title: 'شروط الخدمة — مسودة',
      description: 'مكان مؤقت (مسودة) لشروط الخدمة.',
      body: 'هذه الصفحة مؤقتة. لم تُكتب شروط الخدمة ولم تُراجَع بعد، ولا ينطبق شيء مما هنا.',
    },
    notFound: {
      title: 'الصفحة غير موجودة',
      description: 'هذه الصفحة غير موجودة.',
      body: 'لا توجد صفحة على هذا العنوان.',
      home: 'الذهاب إلى الصفحة الرئيسية',
    },
  },
};

/** A page's path in each language. English at the root, Arabic under /ar/. */
export function pathFor(lang: Lang, page: '' | 'privacy/' | 'terms/' | '404/'): string {
  return lang === 'en' ? `/${page}` : `/ar/${page}`;
}
