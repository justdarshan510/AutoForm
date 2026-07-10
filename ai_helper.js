// Gemini API integration helper
// Communicates with https://generativelanguage.googleapis.com

async function callGemini(apiKey, prompt, systemInstruction = '', jsonMode = false) {
  const model = "gemini-3.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const requestBody = {
    contents: [{
      parts: [{ text: prompt }]
    }]
  };
  
  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }
  
  if (jsonMode) {
    requestBody.generationConfig = {
      responseMimeType: "application/json"
    };
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
    }
    
    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) {
      throw new Error("Empty response from Gemini API");
    }
    
    return jsonMode ? JSON.parse(resultText) : resultText;
  } catch (error) {
    console.error("callGemini error:", error);
    throw error;
  }
}

/**
 * Parses raw resume text into structured profile JSON
 */
async function parseResume(apiKey, resumeText) {
  const systemInstruction = `You are an expert resume parsing assistant. Your task is to extract details from a raw resume text and output a valid JSON object matching the requested schema. Ensure all fields are filled as accurately as possible. Output ONLY the JSON.`;
  
  const schemaPrompt = `
  Analyze this resume and output a JSON object representing the applicant's profile.
  Schema description:
  {
    "firstName": "string",
    "lastName": "string",
    "fullName": "string (combine first and last if needed)",
    "email": "string",
    "phone": "string",
    "dob": "string (YYYY-MM-DD, empty if not found)",
    "gender": "string (Male/Female/Other/Prefer not to say, empty if not found)",
    "nationality": "string (empty if not found)",
    "address": {
      "street": "string",
      "line2": "string",
      "city": "string",
      "state": "string",
      "zip": "string",
      "country": "string"
    },
    "education": [
      {
        "school": "string",
        "degree": "string",
        "major": "string",
        "gpa": "string",
        "startYear": "string",
        "endYear": "string"
      }
    ],
    "experience": [
      {
        "company": "string",
        "title": "string",
        "location": "string",
        "startDate": "string (e.g. 2022-06 or June 2022)",
        "endDate": "string (e.g. 2024-05 or Present)",
        "description": "string (summary of work)"
      }
    ],
    "skills": ["string (array of technical/soft skills)"],
    "projects": [
      {
        "title": "string",
        "description": "string",
        "technologies": ["string"],
        "link": "string"
      }
    ],
    "languages": ["string (languages spoken)"],
    "achievements": ["string (list of accomplishments)"],
    "github": "string (GitHub URL)",
    "linkedin": "string (LinkedIn URL)",
    "portfolio": "string (Portfolio URL)"
  }

  Resume Text:
  """
  ${resumeText}
  """
  `;

  return await callGemini(apiKey, schemaPrompt, systemInstruction, true);
}

/**
 * Generates custom answers for specific application questions
 */
async function generateAnswer(apiKey, profile, questionText, contextText = '') {
  const systemInstruction = `You are a professional job application assistant. Your task is to write a concise, compelling response to a custom job application question using the candidate's profile information. Do not invent achievements. Keep answers professional, relevant, and strictly under 150 words unless requested otherwise. Do not include placeholders.`;
  
  const prompt = `
  Candidate Profile:
  ${JSON.stringify(profile, null, 2)}
  
  Page/Job Context (if any):
  ${contextText}
  
  Question to answer:
  "${questionText}"
  
  Write a polished answer tailored to the candidate's background. Do not write introductory remarks like "Here is your response". Return only the generated response text.
  `;
  
  return await callGemini(apiKey, prompt, systemInstruction, false);
}

/**
 * Classifies an unknown field semantic type using DOM context
 */
async function classifyField(apiKey, labelText, elementContext = '') {
  const systemInstruction = `You are a web page semantic analyzer. Classify the given form field into one of the known profile categories or return "custom" if it is an essay question or "unknown" if it is not mapped. Only output the category name.`;
  
  const prompt = `
  Field Label: "${labelText}"
  HTML Context/Attributes: ${elementContext}
  
  Select one of the following category keys:
  - firstName, lastName, fullName, email, phone, dob, gender, nationality
  - addressStreet, addressLine2, addressCity, addressState, addressZip, addressCountry
  - linkedin, github, portfolio
  - resume, coverLetter, certificates
  - school, degree, major, gpa, gradYear
  - custom (for open text areas requiring written answers)
  - unknown (for inputs that don't map to any of these)
  
  Category Name:`;
  
  const result = await callGemini(apiKey, prompt, systemInstruction, false);
  return result.trim().toLowerCase();
}

// Expose to globalThis
globalThis.AiHelper = {
  parseResume,
  generateAnswer,
  classifyField
};
