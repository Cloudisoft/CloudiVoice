/**
 * Fixed lines the voice engine speaks on its own (fillers, "are you still
 * there?", re-asks, hold/transfer lines) and default openings, per language
 * and agent gender. Regional lines are colloquial, the way people actually
 * speak on the phone, English words included.
 */
import type { UseCase } from "./agentConfig";

export interface Phrases {
  fillers: string[];
  stillThere: string;
  disconnected: string;
  maxDuration: string;
  reask: string[];
  oneMoment: string;
  transferFailed: string;
  reconnected: string;
  goodTime: string;
  thanksForCallingBack: string;
  receptionist: string;
  sales: string;
  support: string;
  recruitment: string;
  followup: string;
}

const EN: Phrases = {
  fillers: ["Sure.", "Okay.", "Right, one moment.", "Got it."],
  stillThere: "Are you still there?",
  disconnected: "It seems we got disconnected. We'll try again later. Thank you!",
  maxDuration: "We're almost out of time for this call. Thank you so much for your time — have a great day!",
  reask: [
    "Sorry, I didn't quite catch that. Could you say it again?",
    "Apologies, the line broke up a little. Could you repeat that?",
    "The line seems a bit unclear — could you speak a little slower and louder?",
  ],
  oneMoment: "Sorry, just a moment.",
  transferFailed: "I'm sorry, nobody from the team could pick up right now. Shall I schedule a callback for you?",
  reconnected: "Sorry about that, the line dropped for a moment. Please go on.",
  goodTime: "Is this a good time to talk for a couple of minutes?",
  thanksForCallingBack: "Thanks for calling back!",
  receptionist: "Hello! This is {{agent_name}} from {{company}}. How can I help you today?",
  sales: "Hi {{first_name}}, this is {{agent_name}} calling from {{company}}. Is now a good time for a quick two-minute chat?",
  support: "Hello, you've reached {{company}} support. I'm {{agent_name}}. What can I help you with?",
  recruitment: "Hi {{first_name}}, this is {{agent_name}} from the {{company}} hiring team. You applied for one of our roles — is this a good time to talk?",
  followup: "Hi {{first_name}}, this is {{agent_name}} from {{company}}, calling back as you requested.",
};

function hindi(male: boolean): Phrases {
  const [raha, sakta, paaya, karun] = male ? ["रहा", "सकता", "पाया", "कर लूँ"] : ["रही", "सकती", "पाई", "कर लूँ"];
  return {
    fillers: ["जी।", "अच्छा।", "जी, एक सेकंड।", "हाँ जी।"],
    stillThere: "क्या आप अभी भी line पर हैं?",
    disconnected: "लगता है आवाज़ नहीं आ रही। हम थोड़ी देर बाद फिर कोशिश करेंगे। धन्यवाद!",
    maxDuration: "हमारा समय लगभग पूरा हो गया है। आपके समय के लिए बहुत धन्यवाद, आपका दिन शुभ हो!",
    reask: [
      `माफ़ कीजिए, मैं ठीक से सुन नहीं ${paaya}। क्या आप दोबारा बता सकते हैं?`,
      "सॉरी, आवाज़ थोड़ी कट गई। एक बार फिर बोलेंगे?",
      "लगता है line थोड़ी साफ़ नहीं है। क्या आप थोड़ा धीरे और ज़ोर से बोल सकते हैं?",
    ],
    oneMoment: "माफ़ कीजिए, एक पल।",
    transferFailed: "माफ़ कीजिए, अभी हमारी team से कोई उपलब्ध नहीं है। क्या मैं आपके लिए callback schedule कर दूँ?",
    reconnected: "माफ़ कीजिए, line थोड़ी देर के लिए कट गई थी। जी, बताइए?",
    goodTime: "क्या अभी दो मिनट बात करना ठीक रहेगा?",
    thanksForCallingBack: "दोबारा call करने के लिए धन्यवाद!",
    receptionist: `नमस्ते! मैं {{company}} से {{agent_name}} बोल ${raha} हूँ। बताइए, मैं आपकी क्या मदद कर ${sakta} हूँ?`,
    sales: `नमस्ते {{first_name}} जी, मैं {{company}} से {{agent_name}} बोल ${raha} हूँ। क्या अभी दो मिनट बात करना ठीक रहेगा?`,
    support: "नमस्ते! {{company}} support में आपका स्वागत है, मैं {{agent_name}} हूँ। बताइए क्या दिक्कत आ रही है?",
    recruitment: `नमस्ते {{first_name}} जी, मैं {{company}} की hiring team से {{agent_name}} बोल ${raha} हूँ। आपने हमारे job के लिए apply किया था, क्या अभी बात हो सकती है?`,
    followup: `नमस्ते {{first_name}} जी, मैं {{company}} से {{agent_name}} बोल ${raha} हूँ। आपने हमें callback के लिए कहा था, तो मैंने सोचा follow up ${karun}।`,
  };
}

const REGIONAL: Record<string, { f: Phrases; m: Phrases }> = {
  "gu-IN": {
    f: {
      fillers: ["હા.","Okay.","હા, એક moment.","Okay."],
      stillThere: "શું તમે હજુ પણ ત્યાં છો?",
      disconnected: "It seems કે આપણું connection disconnect થઈ ગયું. અમે later try કરીશું. Thank you!",
      maxDuration: "આ call માટે almost time out થઈ ગયો છે. Thank you so much for your time, have a great day!",
      reask: ["Sorry, મને તમારો અવાજ properly સંભળાતો નહોતો. તમે એ ફરીથી કહી શકશો please?","Sorry, voice થોડો break થઈ ગયો. એક વાર ફરીથી કહી શકશો?","Line થોડી unclear લાગે છે. થોડું slow અને loud બોલી શકશો?"],
      oneMoment: "Sorry, just a moment.",
      transferFailed: "I’m sorry, team-માંથી કોઈ right now available નથી. શું હું તમારા માટે callback schedule કરી શકું?",
      reconnected: "Sorry, થોડી વાર line drop થઈ ગઈ હતી. હા, please continue કરો.",
      goodTime: "શું આ couple of minutes માટે વાત કરવા માટે good time છે?",
      thanksForCallingBack: "ફરીથી call કરવા બદલ thank you!",
      receptionist: "Hello! હું {{agent_name}} છું, {{company}}-થી બોલી રહી છું. કહો ને, હું તમારી શું help કરી શકું?",
      sales: "Hello {{first_name}}, હું {{agent_name}} છું, {{company}}-થી બોલી રહી છું. શું right now two minutes વાત કરવી okay છે?",
      support: "Hello! {{company}} support-માં welcome, હું {{agent_name}} છું. તમે મને કહો ને, તમને શું problem face થઈ રહ્યો છે?",
      recruitment: "Hello {{first_name}}, હું {{agent_name}} છું, {{company}} hiring team-થી બોલી રહી છું. તમે અમારી job માટે apply કર્યું હતું, શું આપણે right now વાત કરી શકીએ?",
      followup: "Hello {{first_name}}, હું {{agent_name}} છું, {{company}}-થી બોલી રહી છું. તમે અમને callback માટે કીધું હતું, so મેં follow up કરવાનું વિચાર્યું.",
    },
    m: {
      fillers: ["હા.","Okay.","હા, એક minute.","Okay."],
      stillThere: "શું તમે હજુ પણ ત્યાં છો?",
      disconnected: "It seems કે આપણું connection disconnect થઈ ગયું. અમે later try કરીશું. Thank you!",
      maxDuration: "આપણે આ call માટે almost out of time થઈ ગયા છીએ. Thank you so much for your time, have a great day!",
      reask: ["Sorry, મને તમારો અવાજ properly સંભળાતો નહોતો. તમે એ ફરીથી કહી શકશો please?","Sorry, voice થોડો break થઈ ગયો. એક વાર ફરીથી કહી શકશો?","Line થોડી unclear લાગે છે. થોડું slow અને loud બોલી શકશો?"],
      oneMoment: "Sorry, just a moment.",
      transferFailed: "I’m sorry, team-માંથી કોઈ right now available નથી. શું હું તમારા માટે callback schedule કરું?",
      reconnected: "Sorry, થોડી વાર line drop થઈ ગઈ. હા, please continue કરો.",
      goodTime: "શું આ couple of minutes માટે વાત કરવા માટે good time છે?",
      thanksForCallingBack: "ફરીથી call કરવા બદલ thank you!",
      receptionist: "Hello! હું {{agent_name}} છું, {{company}}-થી બોલું છું. કહો ને, હું તમારી શું help કરી શકું?",
      sales: "Hello {{first_name}}, હું {{agent_name}} છું, {{company}}-થી બોલું છું. શું right now two minutes વાત કરવી okay છે?",
      support: "Hello! {{company}} support-માં welcome, હું {{agent_name}} છું. શું તમે મને કહી શકશો કે તમને શું problem face થઈ રહ્યો છે?",
      recruitment: "Hello {{first_name}}, હું {{agent_name}} છું, {{company}} hiring team-થી બોલું છું. તમે અમારી job માટે apply કર્યું હતું, શું આપણે right now વાત કરી શકીએ?",
      followup: "Hello {{first_name}}, હું {{agent_name}} છું, {{company}}-થી બોલી રહ્યો છું. તમે અમને callback માટે કીધું હતું, so મેં follow up કરવાનું વિચાર્યું.",
    },
  },
  "mr-IN": {
    f: {
      fillers: ["नक्कीच.","ठीक आहे.","हो, एक मिनिट.","समजले."],
      stillThere: "तुम्ही अजूनही तिथे आहात का?",
      disconnected: "आपला connection disconnect झाला असे दिसते. आपण नंतर पुन्हा try करू. Thank you!",
      maxDuration: "आपण या call-साठी जवळजवळ time संपला आहे. वेळ दिल्याबद्दल खूप खूप धन्यवाद, have a great day!",
      reask: ["Sorry, मला नीट ऐकू येत नव्हते. तुम्ही ते पुन्हा सांगू शकाल का?","Sorry, voice थोडा break झाला. तुम्ही ते एकदा परत सांगू शकाल का?","Line थोडी unclear वाटते. तुम्ही थोडे slow आणि louder बोलू शकाल का?"],
      oneMoment: "Sorry, एक मिनिट थांबा.",
      transferFailed: "I am sorry, team-मधून कोणीही right now available नाहीये. मी तुमच्यासाठी एक callback schedule करू का?",
      reconnected: "Sorry, line थोड्या वेळासाठी drop झाली होती. हो, please continue करा.",
      goodTime: "हे couple of minutes बोलण्यासाठी good time आहे का?",
      thanksForCallingBack: "पुन्हा call केल्याबद्दल धन्यवाद!",
      receptionist: "नमस्कार! मी {{company}} मधून {{agent_name}} बोलत आहे. तुम्ही मला सांगा, मी तुमची कशी मदत करू शकते?",
      sales: "नमस्कार {{first_name}}, मी {{company}} मधून {{agent_name}} बोलत आहे. आत्ता two minutes बोलणे ठीक आहे का?",
      support: "नमस्कार! {{company}} support-मध्ये Welcome, मी {{agent_name}} आहे. तुम्हाला कोणती problem येत आहे ते सांगाल का?",
      recruitment: "नमस्कार {{first_name}}, मी {{company}} hiring team-मधून {{agent_name}} बोलत आहे. तुम्ही आमच्या job-साठी apply केले होते, आपण आत्ता बोलू शकतो का?",
      followup: "नमस्कार {{first_name}}, मी {{company}} मधून {{agent_name}} बोलत आहे. तुम्ही आम्हाला callback-साठी विचारले होते, म्हणून मी follow up केले.",
    },
    m: {
      fillers: ["नक्कीच.","ठीक आहे.","हो, एक मिनिट.","समजले."],
      stillThere: "तुम्ही अजूनही तिथे आहात का?",
      disconnected: "आपला connection disconnect झाला असे दिसते. आपण नंतर पुन्हा try करू. Thank you!",
      maxDuration: "आपण या call-साठी जवळजवळ time संपला आहे. वेळ दिल्याबद्दल खूप खूप धन्यवाद, have a great day!",
      reask: ["Sorry, मला नीट ऐकू येत नव्हते. तुम्ही ते पुन्हा सांगू शकाल का?","Sorry, voice थोडा break झाला. तुम्ही ते एकदा परत सांगू शकाल का?","Line थोडी unclear वाटते. तुम्ही थोडे slow आणि louder बोलू शकाल का?"],
      oneMoment: "Sorry, एक मिनिट थांबा.",
      transferFailed: "माफ करा, team-मधून कोणीही right now available नाही. मी तुमच्यासाठी एक callback schedule करू का?",
      reconnected: "Sorry, line थोड्या वेळासाठी drop झाली. हो, please continue करा.",
      goodTime: "हे couple of minutes बोलण्यासाठी good time आहे का?",
      thanksForCallingBack: "पुन्हा call केल्याबद्दल धन्यवाद!",
      receptionist: "नमस्कार! मी {{company}} मधून {{agent_name}} बोलत आहे. तुम्ही मला सांगा, मी तुमची कशी मदत करू शकतो?",
      sales: "नमस्कार {{first_name}}, मी {{company}} मधून {{agent_name}} बोलत आहे. आत्ता two minutes बोलणे ठीक आहे का?",
      support: "नमस्कार! {{company}} support मध्ये Welcome, मी {{agent_name}} आहे. तुम्हाला नेमका कोणता problem येत आहे ते सांगाल का?",
      recruitment: "नमस्कार {{first_name}}, मी {{company}} hiring team-मधून {{agent_name}} बोलत आहे. तुम्ही आमच्या job-साठी apply केले होते, आपण आत्ता बोलू शकतो का?",
      followup: "नमस्कार {{first_name}}, मी {{company}} मधून {{agent_name}} बोलत आहे. तुम्ही आम्हाला callback-साठी विचारले होते, म्हणून मी follow up करतो असे वाटले.",
    },
  },
  "pa-IN": {
    f: {
      fillers: ["ਹਾਂਜੀ।","Okay.","ਹਾਂ ਜੀ, ਇੱਕ minute।","ਸਮਝ ਆ ਗਈ।"],
      stillThere: "ਕੀ ਤੁਸੀਂ ਅਜੇ ਵੀ ਉੱਥੇ ਹੋ?",
      disconnected: "ਲੱਗਦਾ ਹੈ ਸਾਡੀ call disconnect ਹੋ ਗਈ। ਅਸੀਂ later try ਕਰਾਂਗੇ। ਸ਼ੁਕਰੀਆ!",
      maxDuration: "ਅਸੀਂ ਇਸ call ਲਈ almost out of time ਹੋ ਗਏ ਹਾਂ। ਤੁਹਾਡੇ time ਲਈ ਬਹੁਤ ਬਹੁਤ ਧੰਨਵਾਦ, have a great day!",
      reask: ["Sorry, ਮੈਂ ਤੁਹਾਨੂੰ properly ਸੁਣ ਨਹੀਂ ਸਕੀ। ਕੀ ਤੁਸੀਂ please ਇਹ ਦੁਬਾਰਾ ਦੱਸ ਸਕਦੇ ਹੋ?","Sorry, voice ਥੋੜ੍ਹੀ ਜਿਹੀ break ਹੋ ਗਈ। ਕੀ ਤੁਸੀਂ ਇਹ ਇੱਕ ਵਾਰ ਹੋਰ ਦੱਸ ਸਕਦੇ ਹੋ?","Line ਥੋੜ੍ਹੀ unclear ਲੱਗ ਰਹੀ ਹੈ। ਕੀ ਤੁਸੀਂ ਥੋੜਾ slow ਤੇ loud ਬੋਲ ਸਕਦੇ ਹੋ?"],
      oneMoment: "Sorry, ਇੱਕ minute।",
      transferFailed: "ਮੈਨੂੰ ਮਾਫ਼ ਕਰਨਾ, team ਵਿੱਚੋਂ ਕੋਈ ਵੀ ਹੁਣ available ਨਹੀਂ ਹੈ। ਕੀ ਮੈਂ ਤੁਹਾਡੇ ਲਈ ਇੱਕ callback schedule ਕਰ ਦਿਆਂ?",
      reconnected: "Sorry, line ਥੋੜੀ ਦੇਰ ਲਈ drop ਹੋ ਗਈ ਸੀ। ਹਾਂਜੀ, please continue ਕਰੋ।",
      goodTime: "ਕੀ ਇਹ ਗੱਲ ਕਰਨ ਲਈ ਇੱਕ good time ਹੈ?",
      thanksForCallingBack: "ਦੁਬਾਰਾ call ਕਰਨ ਲਈ ਧੰਨਵਾਦ!",
      receptionist: "Hello! ਮੈਂ {{company}} ਤੋਂ {{agent_name}} ਬੋਲ ਰਹੀ ਹਾਂ। ਕੀ ਤੁਸੀਂ ਮੈਨੂੰ ਦੱਸ ਸਕਦੇ ਹੋ, ਮੈਂ ਤੁਹਾਡੀ ਕਿਵੇਂ help ਕਰ ਸਕਦੀ ਹਾਂ?",
      sales: "Hello {{first_name}}, ਮੈਂ {{company}} ਤੋਂ {{agent_name}} ਬੋਲ ਰਹੀ ਹਾਂ। ਕੀ ਹੁਣ two minutes ਗੱਲ ਕਰਨਾ ਠੀਕ ਰਹੇਗਾ?",
      support: "Hello! {{company}} support ਵਿੱਚ ਤੁਹਾਡਾ welcome ਹੈ, ਮੈਂ {{agent_name}} ਹਾਂ। ਕੀ ਤੁਸੀਂ please ਮੈਨੂੰ ਦੱਸ ਸਕਦੇ ਹੋ, ਤੁਹਾਨੂੰ ਕਿਹੜੀ problem ਆ ਰਹੀ ਹੈ?",
      recruitment: "Hello {{first_name}}, ਮੈਂ {{company}} hiring team ਤੋਂ {{agent_name}} ਬੋਲ ਰਹੀ ਹਾਂ। ਤੁਸੀਂ ਸਾਡੀ job ਲਈ apply ਕੀਤਾ ਸੀ, ਕੀ ਅਸੀਂ ਹੁਣ ਗੱਲ ਕਰ ਸਕਦੇ ਹਾਂ?",
      followup: "Hello {{first_name}}, ਮੈਂ {{company}} ਤੋਂ {{agent_name}} ਬੋਲ ਰਹੀ ਹਾਂ। ਤੁਸੀਂ ਸਾਨੂੰ callback ਲਈ ਕਿਹਾ ਸੀ, so ਮੈਂ ਸੋਚਿਆ ਕਿ follow up ਕਰਾਂ।",
    },
    m: {
      fillers: ["ਹਾਂਜੀ।","ਠੀਕ ਹੈ।","ਹਾਂ ਜੀ, ਇੱਕ minute।","ਸਮਝ ਗਿਆ।"],
      stillThere: "ਕੀ ਤੁਸੀਂ ਅਜੇ ਵੀ ਉੱਥੇ ਹੋ?",
      disconnected: "ਲੱਗਦਾ ਹੈ ਸਾਡੀ call disconnect ਹੋ ਗਈ। ਅਸੀਂ later try ਕਰਾਂਗੇ। ਸ਼ੁਕਰੀਆ!",
      maxDuration: "ਅਸੀਂ ਇਸ call ਲਈ almost out of time ਹੋ ਗਏ ਹਾਂ। ਤੁਹਾਡੇ time ਲਈ ਬਹੁਤ ਬਹੁਤ ਧੰਨਵਾਦ, have a great day!",
      reask: ["ਮਾਫ਼ ਕਰਨਾ, ਮੈਂ ਤੁਹਾਨੂੰ ਸਹੀ ਤਰ੍ਹਾਂ ਸੁਣ ਨਹੀਂ ਸਕਿਆ। ਕੀ ਤੁਸੀਂ please ਇਹ ਦੁਬਾਰਾ ਦੱਸ ਸਕਦੇ ਹੋ?","Sorry, voice ਥੋੜ੍ਹਾ ਜਿਹਾ break ਹੋ ਗਿਆ। ਕੀ ਤੁਸੀਂ ਇਹ ਇੱਕ ਵਾਰ ਹੋਰ ਦੱਸ ਸਕਦੇ ਹੋ?","Line ਥੋੜ੍ਹੀ unclear ਲੱਗ ਰਹੀ ਹੈ। ਕੀ ਤੁਸੀਂ ਥੋੜਾ slow ਤੇ loud ਬੋਲ ਸਕਦੇ ਹੋ?"],
      oneMoment: "Sorry, ਇੱਕ minute।",
      transferFailed: "ਮੈਨੂੰ ਮਾਫ਼ ਕਰਨਾ, team ਵਿੱਚੋਂ ਕੋਈ ਵੀ ਹੁਣ available ਨਹੀਂ ਹੈ। ਕੀ ਮੈਂ ਤੁਹਾਡੇ ਲਈ ਇੱਕ callback schedule ਕਰ ਦਿਆਂ?",
      reconnected: "Sorry, line ਥੋੜੀ ਦੇਰ ਲਈ drop ਹੋ ਗਈ ਸੀ। ਹਾਂਜੀ, please continue ਕਰੋ।",
      goodTime: "ਕੀ ਹੁਣ ਕੁਝ minutes ਲਈ ਗੱਲ ਕਰਨ ਦਾ ਠੀਕ time ਹੈ?",
      thanksForCallingBack: "ਦੁਬਾਰਾ call ਕਰਨ ਲਈ ਧੰਨਵਾਦ!",
      receptionist: "Hello! ਮੈਂ {{company}} ਤੋਂ {{agent_name}} ਬੋਲ ਰਿਹਾ ਹਾਂ। ਕੀ ਤੁਸੀਂ ਮੈਨੂੰ ਦੱਸ ਸਕਦੇ ਹੋ, ਮੈਂ ਤੁਹਾਡੀ ਕਿਵੇਂ help ਕਰ ਸਕਦਾ ਹਾਂ?",
      sales: "Hello {{first_name}}, ਮੈਂ {{company}} ਤੋਂ {{agent_name}} ਬੋਲ ਰਿਹਾ ਹਾਂ। ਕੀ ਹੁਣ two minutes ਗੱਲ ਕਰਨਾ ਠੀਕ ਰਹੇਗਾ?",
      support: "Hello! {{company}} support ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ, ਮੈਂ {{agent_name}} ਹਾਂ। ਕੀ ਤੁਸੀਂ ਮੈਨੂੰ ਦੱਸ ਸਕਦੇ ਹੋ, ਤੁਹਾਨੂੰ ਕਿਹੜੀ problem ਆ ਰਹੀ ਹੈ?",
      recruitment: "Hello {{first_name}}, ਮੈਂ {{company}} hiring team ਤੋਂ {{agent_name}} ਬੋਲ ਰਿਹਾ ਹਾਂ। ਤੁਸੀਂ ਸਾਡੀ job ਲਈ apply ਕੀਤਾ ਸੀ, ਕੀ ਅਸੀਂ ਹੁਣ ਗੱਲ ਕਰ ਸਕਦੇ ਹਾਂ?",
      followup: "Hello {{first_name}}, ਮੈਂ {{company}} ਤੋਂ {{agent_name}} ਬੋਲ ਰਿਹਾ ਹਾਂ। ਤੁਸੀਂ ਸਾਨੂੰ callback ਲਈ ਕਿਹਾ ਸੀ, so ਮੈਂ ਸੋਚਿਆ ਕਿ follow up ਕਰਾਂ।",
    },
  },
  "bn-IN": {
    f: {
      fillers: ["হ্যাঁ।","ঠিক আছে।","হ্যাঁ, এক মিনিট।","বুঝেছি।"],
      stillThere: "আপনি কি এখনও ওখানে আছেন?",
      disconnected: "মনে হচ্ছে আমাদের connection disconnect হয়ে গেছে। আমরা পরে আবার try করবো। ধন্যবাদ!",
      maxDuration: "এই call-এর time almost শেষ হয়ে গেছে। আপনার time দেওয়ার জন্য অনেক ধন্যবাদ। Have a great day!",
      reask: ["Sorry, আমি আপনার কথা ঠিকমতো শুনতে পাচ্ছিলাম না। আপনি কি একটু আবার বলতে পারবেন?","Sorry, voice-টা একটু break হয়ে গেছে। আপনি কি এটা একবার আবার বলতে পারবেন?","Line-টা একটু unclear লাগছে। আপনি কি একটু slow আর loud বলতে পারবেন?"],
      oneMoment: "Sorry, একটু wait করুন।",
      transferFailed: "Sorry, team থেকে এখন কেউ available নেই। আপনার জন্য একটা callback schedule করবো?",
      reconnected: "Sorry, একটু line drop হয়ে গিয়েছিল। হ্যাঁ, please continue করুন।",
      goodTime: "এই সময়টা কি একটু কথা বলার জন্য ঠিক আছে?",
      thanksForCallingBack: "আবার call করার জন্য ধন্যবাদ!",
      receptionist: "Hello! আমি {{company}} থেকে {{agent_name}} বলছি। আপনি কি বলতে পারবেন, আমি আপনাকে কীভাবে help করতে পারি?",
      sales: "Hello {{first_name}}, আমি {{company}} থেকে {{agent_name}} বলছি। এখন দু'minute কথা বললে কি আপনার কোনো problem হবে?",
      support: "Hello! {{company}} support-এ আপনাকে welcome. আমি {{agent_name}}. আপনি কি বলতে পারবেন, আপনি কী problem face করছেন?",
      recruitment: "Hello {{first_name}}, আমি {{company}} hiring team থেকে {{agent_name}} বলছি। আপনি আমাদের job-এর জন্য apply করেছিলেন, আমরা কি এখন কথা বলতে পারি?",
      followup: "Hello {{first_name}}, আমি {{company}} থেকে {{agent_name}} বলছি। আপনি একটা callback চেয়েছিলেন, তাই ভাবলাম follow up করি।",
    },
    m: {
      fillers: ["হ্যাঁ।","ঠিক আছে।","হ্যাঁ, এক মিনিট।","বুঝেছি।"],
      stillThere: "আপনি কি এখনও ওখানে আছেন?",
      disconnected: "মনে হচ্ছে connection disconnect হয়ে গেছে। আমরা পরে আবার try করবো। ধন্যবাদ!",
      maxDuration: "এই call-এর time almost শেষ হয়ে গেছে। আপনার time দেওয়ার জন্য অনেক ধন্যবাদ। Have a great day!",
      reask: ["Sorry, আমি আপনার কথা ঠিকমতো শুনতে পাচ্ছিলাম না। আপনি কি একটু আবার বলতে পারবেন?","Sorry, voice-টা একটু break হয়ে গেছে। আপনি কি এটা একবার আবার বলতে পারবেন?","Line-টা একটু unclear লাগছে। আপনি কি একটু slow আর loud বলতে পারবেন?"],
      oneMoment: "Sorry, একটু wait করুন।",
      transferFailed: "Sorry, team থেকে এখন কেউ available নেই। আপনার জন্য একটা callback schedule করবো?",
      reconnected: "Sorry, একটু line drop হয়ে গিয়েছিল। হ্যাঁ, please continue করুন।",
      goodTime: "এই সময়টা কি একটু কথা বলার জন্য ঠিক আছে?",
      thanksForCallingBack: "আবার call করার জন্য ধন্যবাদ!",
      receptionist: "Hello! আমি {{company}} থেকে {{agent_name}} বলছি। আপনি কি বলতে পারবেন, আমি আপনাকে কীভাবে help করতে পারি?",
      sales: "Hello {{first_name}}, আমি {{company}} থেকে {{agent_name}} বলছি। এখন দু'minute কথা বলা ঠিক আছে?",
      support: "Hello! {{company}} support-এ আপনাকে welcome. আমি {{agent_name}}. আপনি কি বলতে পারবেন, আপনি কী problem face করছেন?",
      recruitment: "Hello {{first_name}}, আমি {{company}} hiring team থেকে {{agent_name}} বলছি। আপনি আমাদের job-এর জন্য apply করেছিলেন, আমরা কি এখন কথা বলতে পারি?",
      followup: "Hello {{first_name}}, আমি {{company}} থেকে {{agent_name}} বলছি। আপনি একটা callback চেয়েছিলেন, তাই ভাবলাম follow up করি।",
    },
  },
  "ta-IN": {
    f: {
      fillers: ["சரி.","சரி.","சரி, ஒரு moment.","சரி."],
      stillThere: "நீங்க இன்னும் அங்க இருக்கீங்களா?",
      disconnected: "நம்ம call disconnect ஆயிடுச்சுன்னு நினைக்கறேன். அப்பறமா நம்ம try பண்ணிப் பாப்போம். ரொம்ப thanks!",
      maxDuration: "இந்த call-க்கு almost time முடிஞ்சிடுச்சு. Time கொடுத்ததுக்கு ரொம்ப thanks. Have a great day!",
      reask: ["Sorry, நீங்க சொன்னது சரியா கேக்கல. கொஞ்சம் திரும்ப சொல்றீங்களா?","Sorry, voice கொஞ்சம் break ஆயிடுச்சு. ஒரு தடவ திரும்ப சொல்றீங்களா?","Line கொஞ்சம் unclear-ஆ இருக்கு. கொஞ்சம் slow-ஆவும் louder-ஆவும் பேசுறீங்களா?"],
      oneMoment: "Sorry, ஒரு moment.",
      transferFailed: "Sorry, team-ல இருந்து யாரும் இப்ப available-ஆ இல்ல. உங்களுக்காக ஒரு callback schedule பண்ணட்டுமா?",
      reconnected: "Sorry, கொஞ்சம் line drop ஆயிடுச்சு. ஆமா, சொல்லுங்க.",
      goodTime: "ஒரு couple of minutes பேசறதுக்கு உங்களுக்கு time இருக்கா?",
      thanksForCallingBack: "திரும்ப call பண்ணதுக்கு ரொம்ப thanks!",
      receptionist: "ஹலோ! நான் {{company}}-ல இருந்து {{agent_name}} பேசறேன். எப்படி உங்களுக்கு help பண்ணலாம்னு கொஞ்சம் சொல்ல முடியுமா?",
      sales: "Hello {{first_name}}, நான் {{company}}-ல இருந்து {{agent_name}} பேசறேன். இப்போ ரெண்டு minutes பேசலாமா?",
      support: "ஹலோ! {{company}} support-க்கு welcome. நான் {{agent_name}}. நீங்க என்ன problem face பண்றீங்கன்னு கொஞ்சம் சொல்ல முடியுமா?",
      recruitment: "Hello {{first_name}}, நான் {{company}} hiring team-ல இருந்து {{agent_name}} பேசறேன். நீங்க எங்க job-க்கு apply பண்ணிருந்தீங்க, இப்ப பேசலாமா?",
      followup: "Hello {{first_name}}, நான் {{company}}-ல இருந்து {{agent_name}} பேசறேன். நீங்க callback கேட்டீங்க, அதனால நான் follow up பண்ணலாம்னு நெனச்சேன்.",
    },
    m: {
      fillers: ["சரி.","சரி.","சரி, ஒரு minute.","சரி."],
      stillThere: "நீங்க இன்னும் அங்க இருக்கீங்களா?",
      disconnected: "நம்ம call disconnect ஆயிடுச்சுன்னு நினைக்கறேன். அப்பறமா try பண்ணிப் பாப்போம். ரொம்ப thanks!",
      maxDuration: "இந்த call-க்கு almost time முடிஞ்சிடுச்சு. Time கொடுத்ததுக்கு ரொம்ப thanks. Have a great day!",
      reask: ["Sorry, நீங்க சொன்னது சரியா கேக்கல. கொஞ்சம் திரும்ப சொல்றீங்களா?","Sorry, voice கொஞ்சம் break ஆயிடுச்சு. ஒரு தடவ திரும்ப சொல்றீங்களா?","அந்த line கொஞ்சம் unclear-ஆ இருக்கு. கொஞ்சம் slow-ஆவும் louder-ஆவும் பேசுறீங்களா?"],
      oneMoment: "Sorry, ஒரு moment.",
      transferFailed: "Sorry, team-ல இருந்து யாரும் இப்ப available-ஆ இல்ல. உங்களுக்காக ஒரு callback schedule பண்ணட்டுமா?",
      reconnected: "Sorry, கொஞ்சம் line drop ஆயிடுச்சு. ஆமா, சொல்லுங்க.",
      goodTime: "ஒரு couple of minutes பேசறதுக்கு உங்களுக்கு time இருக்கா?",
      thanksForCallingBack: "திரும்ப call பண்ணதுக்கு ரொம்ப thanks!",
      receptionist: "ஹலோ! நான் {{company}}-ல இருந்து {{agent_name}} பேசறேன். எப்படி உங்களுக்கு help பண்ணட்டும்னு கொஞ்சம் சொல்ல முடியுமா?",
      sales: "Hello {{first_name}}, நான் {{company}}-ல இருந்து {{agent_name}} பேசறேன். இப்போ ரெண்டு minutes பேசலாமா?",
      support: "ஹலோ! {{company}} support-க்கு welcome. நான் {{agent_name}}. நீங்க என்ன problem face பண்றீங்கன்னு கொஞ்சம் சொல்ல முடியுமா?",
      recruitment: "Hello {{first_name}}, நான் {{company}} hiring team-ல இருந்து {{agent_name}} பேசறேன். நீங்க எங்க job-க்கு apply பண்ணிருந்தீங்க, இப்ப பேசலாமா?",
      followup: "Hello {{first_name}}, நான் {{company}}-ல இருந்து {{agent_name}} பேசறேன். நீங்க callback கேட்டீங்க, அதனால நான் follow up பண்ணலாம்னு நெனச்சேன்.",
    },
  },
  "te-IN": {
    f: {
      fillers: ["సరే.","సరే.","అవును, ఒక్క నిమిషం.","సరే."],
      stillThere: "ఇంకా అక్కడే ఉన్నారా?",
      disconnected: "మన call disconnect అయిపోయినట్టు ఉంది. తర్వాత try చేస్తాము. Thank you!",
      maxDuration: "ఈ call-కి almost time అయిపోయింది. Time ఇచ్చినందుకు చాలా thank you. Have a great day!",
      reask: ["క్షమించండి, మీరు చెప్పింది సరిగ్గా వినిపించలేదు. దయచేసి మళ్ళీ చెప్తారా?","Sorry, voice కొంచెం break అయింది. ఒక్కసారి మళ్ళీ చెప్తారా?","ఆ line కొంచెం unclear-గా ఉంది. కొంచెం slow-గా, ఇంకా loud-గా మాట్లాడతారా?"],
      oneMoment: "క్షమించండి, ఒక్క నిమిషం.",
      transferFailed: "Sorry! Team నుండి ఎవరూ ఇప్పుడు available లేరు. మీకోసం ఒక callback schedule చేయమంటారా?",
      reconnected: "Sorry, line ఒక్క క్షణం drop అయిపోయింది. అవును, చెప్పండి.",
      goodTime: "ఇది మంచి time-ఆ couple of minutes మాట్లాడటానికి?",
      thanksForCallingBack: "మళ్ళీ call చేసినందుకు thank you!",
      receptionist: "హలో! నేను {{company}} నుండి {{agent_name}} మాట్లాడుతున్నాను. ఎలా help చేయమంటారు?",
      sales: "Hello {{first_name}}, నేను {{company}} నుండి {{agent_name}} మాట్లాడుతున్నాను. ఇప్పుడు two minutes మాట్లాడవచ్చా?",
      support: "హలో! {{company}} support-కి స్వాగతం. నేను {{agent_name}}ని. దయచేసి మీరు ఏ problem face చేస్తున్నారో చెప్పగలరా?",
      recruitment: "Hello {{first_name}}, నేను {{company}} hiring team నుండి {{agent_name}} మాట్లాడుతున్నాను. మీరు మా job-కి apply చేశారు కదా? ఇప్పుడు మాట్లాడవచ్చా?",
      followup: "Hello {{first_name}}, నేను {{company}} నుండి {{agent_name}} మాట్లాడుతున్నాను. మీరు callback అడిగారు కదా, అందుకే follow up చేయాలనుకున్నాను.",
    },
    m: {
      fillers: ["సరే.","సరే.","అవును, ఒక్క నిమిషం.","సరే."],
      stillThere: "ఇంకా అక్కడే ఉన్నారా?",
      disconnected: "మన call disconnect అయిపోయినట్టు ఉంది. తర్వాత try చేస్తాము. Thank you!",
      maxDuration: "ఈ call-కి almost time అయిపోయింది. Time ఇచ్చినందుకు చాలా thank you. Have a great day!",
      reask: ["Sorry, మీరు చెప్పింది సరిగ్గా వినిపించలేదు. దయచేసి మళ్ళీ చెప్తారా?","Sorry, voice కొంచెం break అయింది. ఒక్కసారి మళ్ళీ చెప్తారా?","ఆ line కొంచెం unclear-గా ఉంది. కొంచెం slow-గా, ఇంకా loud-గా మాట్లాడతారా?"],
      oneMoment: "క్షమించండి, ఒక్క నిమిషం.",
      transferFailed: "Sorry! Team నుండి ఎవరూ ఇప్పుడు available లేరు. మీకోసం ఒక callback schedule చేయమంటారా?",
      reconnected: "Sorry, line కొద్దిసేపు drop అయ్యింది. అవును, చెప్పండి.",
      goodTime: "ఇది మంచి time-ఆ couple of minutes మాట్లాడటానికి?",
      thanksForCallingBack: "మళ్ళీ call చేసినందుకు thank you!",
      receptionist: "హలో! నేను {{company}} నుండి {{agent_name}} మాట్లాడుతున్నాను. ఎలా help చేయమంటారు?",
      sales: "Hello {{first_name}}, నేను {{company}} నుండి {{agent_name}} మాట్లాడుతున్నాను. ఇప్పుడు two minutes మాట్లాడవచ్చా?",
      support: "హలో! {{company}} support-కి స్వాగతం. నేను {{agent_name}}ని. దయచేసి మీరు ఏ problem face చేస్తున్నారో చెప్పగలరా?",
      recruitment: "Hello {{first_name}}, నేను {{company}} hiring team నుండి {{agent_name}} మాట్లాడుతున్నాను. మీరు మా job-కి apply చేశారు కదా? ఇప్పుడే మాట్లాడవచ్చా?",
      followup: "Hello {{first_name}}, నేను {{company}} నుండి {{agent_name}} మాట్లాడుతున్నాను. మీరు callback అడిగారు కదా, అందుకే follow up చేయాలనుకున్నాను.",
    },
  },
  "kn-IN": {
    f: {
      fillers: ["ಖಂಡಿತ.","Okay.","ಹೌದು, ಒಂದು moment.","Got it."],
      stillThere: "ನೀವು ಇನ್ನೂ ಅಲ್ಲೇ ಇದ್ದೀರಾ?",
      disconnected: "ನಮ್ಮ call disconnect ಆಗಿ ಹೋಗಿದೆ ಅಂತ ಕಾಣುತ್ತೆ. ನಾವು later try again ಮಾಡ್ತೀವಿ. Thank you!",
      maxDuration: "ಈ call-ಗೆ almost time ಮುಗೀತಾ ಇದೆ. ನಿಮ್ಮ time-ಗೋಸ್ಕರ ತುಂಬಾ thanks, have a great day!",
      reask: ["ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ಮಾತು ಸರಿಯಾಗಿ ಕೇಳಿಸ್ಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಅದನ್ನ ಒಮ್ಮೆ repeat ಮಾಡ್ತೀರಾ?","ಕ್ಷಮಿಸಿ, voice ಸ್ವಲ್ಪ break ಆಯ್ತು. ಒಮ್ಮೆ ಮತ್ತೆ ಹೇಳ್ತೀರಾ?","Line ಸ್ವಲ್ಪ unclear ಇದೆ ಅಂತ ಅನ್ಸುತ್ತೆ. ನೀವು ಸ್ವಲ್ಪ slow ಆಗಿ ಮತ್ತು louder ಆಗಿ ಮಾತಾಡಬಹುದಾ?"],
      oneMoment: "ಕ್ಷಮಿಸಿ, just ಒಂದು moment.",
      transferFailed: "ಕ್ಷಮಿಸಿ, team-ನಿಂದ ಯಾರೂ ಈಗ available ಇಲ್ಲ. ನಾನು ನಿಮಗೋಸ್ಕರ callback schedule ಮಾಡ್ಲಾ?",
      reconnected: "ಕ್ಷಮಿಸಿ, line ಸ್ವಲ್ಪ ಹೊತ್ತು drop ಆಯ್ತು. ಹೌದು, please continue ಮಾಡಿ.",
      goodTime: "Couple of minutes ಮಾತಾಡೋಕೆ ಇದು good time-ಆ ಅಲ್ವಾ?",
      thanksForCallingBack: "ಮತ್ತೆ call ಮಾಡಿದ್ದಕ್ಕೆ thank you!",
      receptionist: "Hello! ನಾನು {{company}}-ನಿಂದ {{agent_name}} ಮಾತಾಡ್ತಿದ್ದೀನಿ. ದಯವಿಟ್ಟು ಹೇಳಿ, ನಾನು ನಿಮಗೆ ಹೇಗೆ help ಮಾಡಬಹುದು?",
      sales: "Hello {{first_name}}, ನಾನು {{company}}-ನಿಂದ {{agent_name}} ಮಾತಾಡ್ತಿದ್ದೀನಿ. ಈಗ two minutes ಮಾತಾಡೋಕೆ okay-ನಾ?",
      support: "Hello! {{company}} support-ಗೆ Welcome, ನಾನು {{agent_name}}. ದಯವಿಟ್ಟು ಹೇಳಿ, ನೀವು ಯಾವ problem face ಮಾಡ್ತಿದ್ದೀರಿ?",
      recruitment: "Hello {{first_name}}, ನಾನು {{company}} hiring team-ನಿಂದ {{agent_name}} ಮಾತಾಡ್ತಿದ್ದೀನಿ. ನೀವು ನಮ್ಮ job-ಗೆ apply ಮಾಡಿದ್ರಿ, ಈಗ ನಾವು ಮಾತಾಡಬಹುದಾ?",
      followup: "Hello {{first_name}}, ನಾನು {{company}} ಇಂದ {{agent_name}} ಮಾತಾಡ್ತಿದ್ದೀನಿ. ನೀವು callback ಕೇಳಿದ್ರಿ, so ನಾನು follow up ಮಾಡ್ತೀನಿ ಅಂತ ಅಂದುಕೊಂಡೆ.",
    },
    m: {
      fillers: ["ಖಂಡಿತ.","Okay.","ಹೌದು, ಒಂದು moment.","Got it."],
      stillThere: "ನೀವು ಇನ್ನೂ ಅಲ್ಲೇ ಇದ್ದೀರಾ?",
      disconnected: "ನಮ್ಮ call disconnect ಆಗಿ ಹೋಗಿದೆ ಅಂತ ಕಾಣುತ್ತೆ. ನಾವು later try again ಮಾಡ್ತೀವಿ. Thank you!",
      maxDuration: "ಈ call-ಗೆ almost time ಮುಗೀತಾ ಇದೆ. ನಿಮ್ಮ time-ಗೋಸ್ಕರ ತುಂಬಾ thanks, have a great day!",
      reask: ["ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ಮಾತು ಸರಿಯಾಗಿ ಕೇಳಿಸ್ಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಅದನ್ನ ಒಮ್ಮೆ repeat ಮಾಡ್ತೀರಾ?","ಕ್ಷಮಿಸಿ, voice ಸ್ವಲ್ಪ break ಆಯ್ತು. ಒಮ್ಮೆ ಮತ್ತೆ ಹೇಳ್ತೀರಾ?","Line ಸ್ವಲ್ಪ unclear ಇದೆ ಅಂತ ಅನ್ಸುತ್ತೆ. ನೀವು ಸ್ವಲ್ಪ slow ಆಗಿ ಮತ್ತು loud ಆಗಿ ಮಾತಾಡೋಕೆ ಆಗುತ್ತಾ?"],
      oneMoment: "ಕ್ಷಮಿಸಿ, just ಒಂದು moment.",
      transferFailed: "ಕ್ಷಮಿಸಿ, team-ನಿಂದ ಯಾರೂ ಈಗ available ಇಲ್ಲ. ನಾನು ನಿಮಗೋಸ್ಕರ callback schedule ಮಾಡ್ಲಾ?",
      reconnected: "ಕ್ಷಮಿಸಿ, line ಒಂದು ಕ್ಷಣ drop ಆಯ್ತು. ಹೌದು, please continue ಮಾಡಿ.",
      goodTime: "Couple of minutes ಮಾತಾಡೋಕೆ ಇದು good time-ಆ ಅಲ್ವಾ?",
      thanksForCallingBack: "ಮತ್ತೆ call ಮಾಡಿದ್ದಕ್ಕೆ thank you!",
      receptionist: "Hello! ನಾನು {{company}}-ನಿಂದ {{agent_name}} ಮಾತಾಡ್ತಿದ್ದೀನಿ. ದಯವಿಟ್ಟು ಹೇಳಿ, ನಾನು ನಿಮಗೆ ಹೇಗೆ help ಮಾಡಬಹುದು?",
      sales: "Hello {{first_name}}, ನಾನು {{company}} ಇಂದ {{agent_name}} ಮಾತಾಡ್ತಿದ್ದೀನಿ. ಈಗ two minutes ಮಾತಾಡೋಕೆ okay-ನಾ?",
      support: "Hello! {{company}} support-ಗೆ Welcome, ನಾನು {{agent_name}}. ದಯವಿಟ್ಟು ಹೇಳಿ, ನೀವು ಯಾವ problem face ಮಾಡ್ತಿದ್ದೀರಿ?",
      recruitment: "Hello {{first_name}}, ನಾನು {{company}} hiring team-ನಿಂದ {{agent_name}} ಮಾತಾಡ್ತಿದ್ದೀನಿ. ನೀವು ನಮ್ಮ job-ಗೆ apply ಮಾಡಿದ್ರಿ, ಈಗ ನಾವು ಮಾತಾಡಬಹುದಾ?",
      followup: "Hello {{first_name}}, ನಾನು {{company}} ಇಂದ {{agent_name}} ಮಾತಾಡ್ತಿದ್ದೀನಿ. ನೀವು callback ಕೇಳಿದ್ರಿ, so ನಾನು follow up ಮಾಡ್ತೀನಿ ಅಂತ ಅಂದುಕೊಂಡೆ.",
    },
  },
  "ml-IN": {
    f: {
      fillers: ["ശരി.","ഓക്കെ.","അതെ, ഒരു moment.","മനസ്സിലായി."],
      stillThere: "താങ്കൾ ഇപ്പോഴും അവിടെ ഉണ്ടോ?",
      disconnected: "നമ്മുടെ call disconnect ആയപോലെ തോന്നുന്നു. നമ്മൾ later try ചെയ്യാം. Thanks!",
      maxDuration: "ഈ call-ന് almost time ആയി. താങ്കളുടെ time-ന് വളരെ നന്ദി, ഒരു great day ആശംസിക്കുന്നു!",
      reask: ["ക്ഷമിക്കണം, എനിക്ക് താങ്കളെ ശരിക്കും കേൾക്കാൻ കഴിഞ്ഞില്ല. താങ്കൾക്ക് അത് ഒന്നുകൂടി repeat ചെയ്യാമോ?","Sorry, voice കുറച്ചു break ആയി പോയി. ഒന്നുകൂടി പറയാമോ?","Line കുറച്ചു unclear ആയിട്ടുണ്ടല്ലോ. കുറച്ചുകൂടി slow ആയും loud ആയും സംസാരിക്കാമോ?"],
      oneMoment: "Sorry, ഒരു moment.",
      transferFailed: "Sorry, team-ൽ നിന്ന് ആർക്കും ഇപ്പോൾ available അല്ല. താങ്കൾക്ക് ഒരു callback schedule ചെയ്യണോ?",
      reconnected: "Sorry, line ഒരു moment drop ആയിപ്പോയി. അതെ, continue ചെയ്യൂ.",
      goodTime: "ഒരു couple of minutes സംസാരിക്കാൻ ഇത് ഒരു good time ആണോ?",
      thanksForCallingBack: "വീണ്ടും call ചെയ്തതിന് thanks!",
      receptionist: "Hello! ഞാൻ {{company}}-ൽ നിന്ന് {{agent_name}} ആണ് സംസാരിക്കുന്നത്. താങ്കളെ എങ്ങനെ help ചെയ്യാനാകും?",
      sales: "Hello {{first_name}}, ഞാൻ {{company}}-ൽ നിന്ന് {{agent_name}} ആണ് സംസാരിക്കുന്നത്. ഇപ്പോൾ two minutes സംസാരിച്ചാൽ കുഴപ്പമുണ്ടോ?",
      support: "Hello! {{company}} support-ലേക്ക് welcome, ഞാൻ {{agent_name}} ആണ്. എന്താണ് problem എന്ന് പറയാമോ?",
      recruitment: "Hello {{first_name}}, {{company}} hiring team-ൽ നിന്ന് {{agent_name}} ആണ് സംസാരിക്കുന്നത്. താങ്കൾ ഞങ്ങളുടെ job-ന് apply ചെയ്തിരുന്നല്ലോ, നമുക്ക് ഇപ്പോൾ സംസാരിക്കാമോ?",
      followup: "Hello {{first_name}}, ഞാൻ {{company}}-ൽ നിന്ന് {{agent_name}} ആണ് സംസാരിക്കുന്നത്. താങ്കൾ ഒരു callback ചോദിച്ചിരുന്നല്ലോ, അതുകൊണ്ട് ഞാൻ follow up ചെയ്യാൻ പോയതാണ്.",
    },
    m: {
      fillers: ["ശരി.","ഓക്കെ.","അതെ, ഒരു moment.","മനസ്സിലായി."],
      stillThere: "താങ്കൾ ഇപ്പോഴും അവിടെ ഉണ്ടോ?",
      disconnected: "നമ്മുടെ call disconnect ആയപോലെ തോന്നുന്നു. നമ്മൾ later try ചെയ്തോളാം. Thanks!",
      maxDuration: "ഈ call-ന് almost time ആയി. താങ്കളുടെ time-ന് വളരെ നന്ദി, ഒരു great day ആശംസിക്കുന്നു!",
      reask: ["ക്ഷമിക്കണം, എനിക്ക് താങ്കളെ ശരിക്കും കേൾക്കാൻ കഴിഞ്ഞില്ല. താങ്കൾക്ക് അത് ഒന്നുകൂടി repeat ചെയ്യാമോ?","Sorry, voice കുറച്ചു break ആയി പോയി. ഒന്നുകൂടി പറയാമോ?","Line കുറച്ചു unclear ആയിട്ടുണ്ടല്ലോ. കുറച്ചുകൂടി slow ആയും louder ആയും സംസാരിക്കാമോ?"],
      oneMoment: "Sorry, ഒരു moment.",
      transferFailed: "ക്ഷമിക്കണം, team-ൽ നിന്ന് ആർക്കും ഇപ്പോൾ available അല്ല. താങ്കൾക്ക് ഒരു callback schedule ചെയ്യണോ?",
      reconnected: "Sorry, line ഒരു moment drop ആയിപ്പോയി. അതെ, continue ചെയ്യൂ.",
      goodTime: "ഒരു couple of minutes സംസാരിക്കാൻ ഇത് ഒരു good time ആണോ?",
      thanksForCallingBack: "വീണ്ടും call ചെയ്തതിന് thanks!",
      receptionist: "Hello! ഞാൻ {{company}}-ൽ നിന്ന് {{agent_name}} ആണ് സംസാരിക്കുന്നത്. താങ്കളെ എങ്ങനെ help ചെയ്യാനാകും?",
      sales: "Hello {{first_name}}, ഞാൻ {{company}}-ൽ നിന്ന് {{agent_name}} ആണ് സംസാരിക്കുന്നത്. ഇപ്പോൾ two minutes സംസാരിച്ചാൽ കുഴപ്പമുണ്ടോ?",
      support: "Hello! {{company}} support-ലേക്ക് welcome, ഞാൻ {{agent_name}} ആണ്. എന്താണ് problem എന്ന് പറയാമോ?",
      recruitment: "Hello {{first_name}}, {{company}} hiring team-ൽ നിന്ന് {{agent_name}} ആണ് സംസാരിക്കുന്നത്. താങ്കൾ ഞങ്ങളുടെ job-ന് apply ചെയ്തിരുന്നല്ലോ, നമുക്ക് ഇപ്പോൾ സംസാരിക്കാമോ?",
      followup: "Hello {{first_name}}, ഞാൻ {{company}}-ൽ നിന്ന് {{agent_name}} ആണ് സംസാരിക്കുന്നത്. താങ്കൾ ഒരു callback ചോദിച്ചിരുന്നല്ലോ, അതുകൊണ്ട് ഞാൻ follow up ചെയ്യാമെന്ന് വിചാരിച്ചു.",
    },
  },
  "od-IN": {
    f: {
      fillers: ["ହଁ।","Okay।","ହଁ, ଗୋଟିଏ moment।","ହଁ, ବୁଝିଗଲି।"],
      stillThere: "ଆପଣ ଏବେ ବି ସେଠି ଅଛନ୍ତି କି?",
      disconnected: "ଲାଗୁଛି ଆମର କଥା disconnect ହୋଇଗଲା। ଆମେ ପରେ ପୁଣି try କରିବୁ। ଧନ୍ୟବାଦ!",
      maxDuration: "ଆମେ ଏହି call ପାଇଁ ପ୍ରାୟ ସମୟ ସରିଯାଇଛି। ଆପଣଙ୍କ ସମୟ ପାଇଁ ବହୁତ ବହୁତ ଧନ୍ୟବାଦ, ଆପଣଙ୍କର ଦିନଟି ଭଲରେ କଟୁ!",
      reask: ["Sorry, ମୁଁ ଆପଣଙ୍କୁ ଠିକ୍ ଭାବରେ ଶୁଣିପାରିଲି ନାହିଁ। Please ଆପଣ ଆଉ ଥରେ କହିପାରିବେ କି?","Sorry, voice ଟିକେ ଭାଙ୍ଗିଗଲା। ଆପଣ ଏହାକୁ ଆଉ ଥରେ କହିପାରିବେ କି?","Line-ଟା ଟିକେ unclear ଲାଗୁଛି। ଆପଣ ଟିକେ slow ଏବଂ loud କଥା ହୋଇପାରିବେ କି?"],
      oneMoment: "Sorry, ଟିକେ wait କରନ୍ତୁ।",
      transferFailed: "I'm sorry, team-ରୁ ଏବେ କେହି available ନାହାନ୍ତି। ଆପଣଙ୍କ ପାଇଁ ମୁଁ ଏକ callback schedule କରିଦେବି କି?",
      reconnected: "Sorry, ଟିକେ ସମୟ ପାଇଁ line drop ହୋଇଗଲା। ହଁ, please continue କରନ୍ତୁ।",
      goodTime: "କିଛି ମିନିଟ୍ କଥା ହେବା ପାଇଁ ଏହା କି ଭଲ time?",
      thanksForCallingBack: "ଆଉ ଥରେ call କରିବା ପାଇଁ ଧନ୍ୟବାଦ!",
      receptionist: "Hello! ମୁଁ {{company}}-ରୁ {{agent_name}} କହୁଛି। ଦୟାକରି କୁହନ୍ତୁ, ମୁଁ ଆପଣଙ୍କୁ କିପରି help କରିପାରିବି?",
      sales: "Hello {{first_name}}, ମୁଁ {{company}}-ରୁ {{agent_name}} କହୁଛି। ଏବେ ଦୁଇ ମିନିଟ୍ କଥା ହୋଇପାରିବେ କି?",
      support: "Hello! {{company}} support-କୁ welcome, ମୁଁ {{agent_name}}। Please ମୋତେ କୁହନ୍ତୁ, ଆପଣ କଣ problem face କରୁଛନ୍ତି?",
      recruitment: "Hello {{first_name}}, ମୁଁ {{company}} hiring team-ରୁ {{agent_name}} କହୁଛି। ଆପଣ ଆମର job ପାଇଁ apply କରିଥିଲେ, ଆମେ ଏବେ କଥା ହୋଇପାରିବା କି?",
      followup: "Hello {{first_name}}, ମୁଁ {{company}}-ରୁ {{agent_name}} କହୁଛି। ଆପଣ ଆମକୁ callback ମାଗିଥିଲେ, ତେଣୁ ମୁଁ ଭାବିଲି follow up କରିଦେଖେ।",
    },
    m: {
      fillers: ["ହଁ।","Okay।","ହଁ, ଗୋଟିଏ moment।","ହଁ, ବୁଝିଗଲି।"],
      stillThere: "ଆପଣ ଏବେ ବି ସେଠି ଅଛନ୍ତି କି?",
      disconnected: "ଲାଗୁଛି ଆମର କଥା disconnect ହୋଇଗଲା। ଆମେ ପରେ ପୁଣି try କରିବୁ। ଧନ୍ୟବାଦ!",
      maxDuration: "ଆମେ ଏହି call ପାଇଁ ପ୍ରାୟ ସମୟ ସରିଯାଇଛି। ଆପଣଙ୍କ ସମୟ ପାଇଁ ବହୁତ ବହୁତ ଧନ୍ୟବାଦ, ଆପଣଙ୍କର ଦିନଟି ଭଲରେ କଟୁ!",
      reask: ["Sorry, ମୁଁ ଆପଣଙ୍କୁ ଠିକ୍ ଭାବରେ ଶୁଣିପାରିଲି ନାହିଁ। Please ଆପଣ ଆଉ ଥରେ କହିପାରିବେ କି?","Sorry, voice ଟିକେ ଭାଙ୍ଗିଗଲା। ଆପଣ ଏହାକୁ ଆଉ ଥରେ କହିପାରିବେ କି?","Line-ଟା ଟିକେ unclear ଲାଗୁଛି। ଆପଣ ଟିକେ slow ଏବଂ loud କଥା ହୋଇପାରିବେ କି?"],
      oneMoment: "Sorry, ଟିକେ wait କରନ୍ତୁ।",
      transferFailed: "I'm sorry, team-ରୁ ଏବେ କେହି available ନାହାନ୍ତି। ଆପଣଙ୍କ ପାଇଁ ମୁଁ ଏକ callback schedule କରିଦେବି କି?",
      reconnected: "Sorry, ଟିକେ ସମୟ ପାଇଁ line drop ହୋଇଗଲା। ହଁ, please continue କରନ୍ତୁ।",
      goodTime: "କିଛି ମିନିଟ୍ କଥା ହେବା ପାଇଁ ଏହା କି ଏକ good time?",
      thanksForCallingBack: "ଆଉ ଥରେ call କରିବା ପାଇଁ ଧନ୍ୟବାଦ!",
      receptionist: "Hello! ମୁଁ {{company}}-ରୁ {{agent_name}} କହୁଛି। ଦୟାକରି କୁହନ୍ତୁ, ମୁଁ ଆପଣଙ୍କୁ କିପରି help କରିପାରିବି?",
      sales: "Hello {{first_name}}, ମୁଁ {{company}}-ରୁ {{agent_name}} କହୁଛି। ଏବେ ଦୁଇ ମିନିଟ୍ କଥା ହୋଇପାରିବେ କି?",
      support: "Hello! {{company}} support-କୁ welcome, ମୁଁ {{agent_name}}। Please ମୋତେ କୁହନ୍ତୁ, ଆପଣ କଣ problem face କରୁଛନ୍ତି?",
      recruitment: "Hello {{first_name}}, ମୁଁ {{company}} hiring team-ରୁ {{agent_name}} କହୁଛି। ଆପଣ ଆମର job ପାଇଁ apply କରିଥିଲେ, ଆମେ ଏବେ କଥା ହୋଇପାରିବା କି?",
      followup: "Hello {{first_name}}, ମୁଁ {{company}}-ରୁ {{agent_name}} କହୁଛି। ଆପଣ ଆମକୁ callback ମାଗିଥିଲେ, ତେଣୁ ମୁଁ ଭାବିଲି follow up କରିଦେଖେ।",
    },
  },
};

const TABLE: Record<string, { f: Phrases; m: Phrases }> = {
  "hi-IN": { f: hindi(false), m: hindi(true) },
  "en-IN": { f: EN, m: EN },
  ...REGIONAL,
};

/** The engine's own lines in a language (English when the language has none). */
export function phrases(language: string, gender: "female" | "male" = "female"): Phrases {
  const t = TABLE[language] ?? TABLE["en-IN"]!;
  return gender === "male" ? t.m : t.f;
}

export function hasPhrases(language: string) {
  return language in TABLE;
}

export function openingPhrase(useCase: UseCase, language: string, gender: "female" | "male") {
  return phrases(language, gender)[useCase];
}
