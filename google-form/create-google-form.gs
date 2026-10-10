/**
 * Creates the "AI search survey" Google Form (10 multiple-choice questions)
 * in your own Google account. Same questions as docs/validation-log.md.
 *
 * How to run: script.google.com -> New project -> paste this file -> Run
 * createSurvey -> approve the permission prompt -> open View > Logs for links.
 */
function createSurvey() {
  var QS = [
    ["Which best describes your work?",
      ["Marketing, growth or SEO at a company", "Founder or owner", "Sales or business development",
       "Product or engineering", "Agency or consultant", "Something else"]],
    ["What kind of organisation do you work in?",
      ["B2B software or fintech", "Another kind of B2B company", "Consumer brand", "Agency",
       "I don't work at a company"]],
    ["In the last 30 days, how often did you use ChatGPT, Perplexity, Gemini or a similar tool to research a product, tool or vendor?",
      ["Not at all", "Once or twice", "About weekly", "Several times a week", "Daily"]],
    ["In the last 6 months, has anyone (boss, client, investor, customer) asked whether your company shows up in AI answers?",
      ["Yes, more than once", "Yes, once", "No, but I wondered myself", "No, never", "Not applicable to me"]],
    ["The last time that came up, what did you do?",
      ["Nothing", "Typed the question into an AI tool myself", "Asked an agency or a colleague",
       "Used a paid tool", "It has not come up"]],
    ["In a typical month, how long do you spend checking this by hand?",
      ["None", "Under 1 hour", "1 to 3 hours", "More than 3 hours", "Not applicable"]],
    ["How do you report on AI search to leadership today?",
      ["I don't", "Screenshots or anecdotes", "A spreadsheet I keep", "My agency reports it", "A tool dashboard"]],
    ["If you had a number showing how often AI engines recommend your brand against 3 competitors, what would you most likely do with it?",
      ["Put it in a leadership report", "Decide where to spend content effort", "Justify or defend budget",
       "Probably not use it", "Not sure"]],
    ["What would stop you trusting that number?",
      ["It changes every time it is run", "I don't know how it was measured",
       "It can't be tied to traffic or revenue", "I'd want a person to check the labels",
       "Nothing, I'd trust it"]],
    ["For a monthly re-run with 5 prioritised fixes, what could you approve without a procurement process?",
      ["Nothing, it needs approval", "Up to S$100 a month", "S$100 to S$300 a month",
       "S$300 to S$500 a month", "More than S$500 a month"]]
  ];

  var form = FormApp.create("How do you find out if AI recommends your brand?");
  form.setDescription(
    "Krishna is researching how marketing teams check whether ChatGPT, Perplexity and Gemini mention their company. " +
    "Ten multiple-choice questions, about 2 minutes, no right answers. No names or emails are collected. " +
    "If a question does not apply to you, pick the 'not applicable' style option.");
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);   // keeps the form open to people without Google sign-in
  form.setShowLinkToRespondAgain(false);
  form.setProgressBar(true);
  form.setConfirmationMessage("Thank you. Your answers are recorded.");

  QS.forEach(function (q, i) {
    form.addMultipleChoiceItem()
      .setTitle((i + 1) + ". " + q[0])
      .setChoiceValues(q[1])
      .setRequired(true);
  });

  // Responses go into a linked spreadsheet in your Drive.
  var ss = SpreadsheetApp.create("AI search survey: responses");
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  Logger.log("Share this link:  " + form.getPublishedUrl());
  Logger.log("Edit the form:    " + form.getEditUrl());
  Logger.log("Responses sheet:  " + ss.getUrl());
}
