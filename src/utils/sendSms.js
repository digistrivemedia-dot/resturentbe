// SmartPing SMS gateway — JSON POST method (not the GET-with-credentials-in-URL
// form) so username/password never end up in a logged URL.
const SMARTPING_URL = "https://pgapi.smartping.ai/fe/api/v1/message";

const sendSms = async ({ to, text }) => {
  const auth = Buffer.from(
    `${process.env.SMARTPING_USERNAME}:${process.env.SMARTPING_PASSWORD}`
  ).toString("base64");

  const response = await fetch(SMARTPING_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      extra: { dltContentId: process.env.SMARTPING_DLT_CONTENT_ID },
      message: { recipient: to, text },
      sender: process.env.SMARTPING_SENDER_ID,
      unicode: false,
    }),
  });

  const data = await response.json();
  if (process.env.NODE_ENV !== "production") {
    console.log(`[SmartPing SMS] to ${to}:`, data);
  }
  if (data.state !== "SUBMIT_ACCEPTED") {
    throw new Error(data.description || "Failed to send SMS");
  }
  return data;
};

module.exports = sendSms;
