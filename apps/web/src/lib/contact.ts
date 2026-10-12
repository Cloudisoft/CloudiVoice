/** Sales contact for custom plans. Both numbers take calls and WhatsApp. */
export const CONTACT = {
  email: "info@cloudisoft.com",
  phones: [
    { display: "+91 88668 19132", digits: "918866819132" },
    { display: "+91 96607 36553", digits: "919660736553" },
  ],
} as const;

const WA_TEXT = "Hi Cloudisoft, I'd like a custom CloudiVoice plan for my business.";

export const whatsappLink = (digits: string) => `https://wa.me/${digits}?text=${encodeURIComponent(WA_TEXT)}`;
export const telLink = (digits: string) => `tel:+${digits}`;
export const mailLink = () => `mailto:${CONTACT.email}?subject=${encodeURIComponent("CloudiVoice custom plan")}`;
