// Heuristics for mapping form fields to profile data locally.
// Exposes window.FieldRules to be shared across scripts.

const FIELD_RULES = {
  firstName: [/first\s*name/i, /^fname$/i, /given\s*name/i],
  lastName: [/last\s*name/i, /^lname$/i, /family\s*name/i, /surname/i],
  fullName: [/full\s*name/i, /^name$/i, /candidate\s*name/i, /applicant\s*name/i, /legal\s*name/i],
  email: [/email/i, /e-mail/i],
  phone: [/phone/i, /mobile/i, /contact\s*num/i, /telephone/i, /^tel$/i, /cellphone/i],
  dob: [/dob/i, /date\s*of\s*birth/i, /birthdate/i, /born/i],
  gender: [/gender/i, /sex/i],
  nationality: [/nationality/i, /citizenship/i, /citizen/i],
  
  // Address
  addressStreet: [/street/i, /address\s*line\s*1/i, /address1/i, /location/i],
  addressLine2: [/address\s*line\s*2/i, /address2/i, /suite/i, /apt/i, /apartment/i],
  addressCity: [/city/i, /town/i],
  addressState: [/state/i, /province/i, /region/i],
  addressZip: [/zip/i, /postal/i, /postcode/i],
  addressCountry: [/country/i, /nation$/i],
  
  // Links
  linkedin: [/linkedin/i, /linked\s*in/i],
  github: [/github/i, /git\s*hub/i],
  portfolio: [/portfolio/i, /website/i, /personal\s*web/i, /homepage/i],
  
  // Files
  resume: [/resume/i, /cv/i, /curriculum\s*vitae/i],
  coverLetter: [/cover\s*letter/i, /cl\b/i],
  certificates: [/certificat/i, /cert\b/i],
  
  // Single-item fallback fields for education/experience
  school: [/school/i, /university/i, /college/i, /institution/i],
  degree: [/degree/i, /diploma/i],
  major: [/major/i, /study/i, /specialization/i, /discipline/i],
  gpa: [/gpa/i, /grade/i, /marks/i, /score/i],
  gradYear: [/grad\w*\s*year/i, /passing\s*year/i, /completed/i, /graduation/i]
};

// Helper function to match text against rules
function matchFieldRules(text) {
  if (!text) return null;
  text = text.trim();
  for (const [fieldKey, regexes] of Object.entries(FIELD_RULES)) {
    for (const regex of regexes) {
      if (regex.test(text)) {
        return fieldKey;
      }
    }
  }
  return null;
}

// Export for all environments via globalThis
globalThis.FieldRules = {
  rules: FIELD_RULES,
  match: matchFieldRules
};
