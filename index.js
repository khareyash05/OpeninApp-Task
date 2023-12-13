const { google } = require("googleapis");
const { promisify } = require("util");
const readline = require("readline");

const fs = require("fs");

// getting credentials from google oauth provider
const {client_id,client_secret} = require("credentials.json").web;

const redirect_uris = ["http://localhost:5000"];

// store resources in token.json file
const token = "token.json"; 
const startProject = async() => {
  const gmail = await setupMail();

  if (!gmail) {
    console.error("Error initializing Gmail API");
    return;
  }

  while (true) {
    try {
      const emailDetails = await checkForNewEmails(gmail);

      if (emailDetails) {
        const success = await sendResponses(
          gmail,
          emailDetails,
          "khareyash05@gmail.com"
        );
        console.log(`New email received with ID: ${emailDetails.id}`);
        console.log(`Recipient Address: ${emailDetails.recipientAddress}`);

        if (success) {
          await labelAndMoveEmail(gmail, emailDetails.id, "AWAY");
        }
      }

      const interval = Math.floor(Math.random() * (120 - 45 + 1) + 45);
      console.log(`Waiting for ${interval} seconds...`);
      await sleep(interval * 1000); // Convert seconds to milliseconds
    } catch (error) {
      console.error("Error:", error);
    }
  }
}
startProject();


const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

const getAuthorizationCode = async() =>{
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("Authorize this app by visiting this URL:", authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Enter the authorization code: ", (code) => {
      rl.close();
      resolve(code.trim());
    });
  });
}

const getSecretTokenForMail = async() => {
  try {
    const token = await promisify(fs.readFile)(token);
    oAuth2Client.setCredentials(JSON.parse(token));
  } catch (err) {
    const authCode = await getAuthorizationCode();
    const { tokens } = await oAuth2Client.getToken(authCode);
    oAuth2Client.setCredentials(tokens);

    // Store the obtained token
    fs.writeFileSync(token, JSON.stringify(tokens));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const setupMail  = async () => {
  await getSecretTokenForMail();

  try {
    // Log the tokens (optional)
    console.log("Access token:", oAuth2Client.credentials.access_token);
    console.log("Refresh token:", oAuth2Client.credentials.refresh_token);

    // Create Gmail client
    return google.gmail({
      version: "v1",
      auth: oAuth2Client,
      userEmail: "khareyash05@gmail.com",
    });
  } catch (err) {
    console.error("Error loading credentials:", err);
    return null;
  }
}

// function to save token in token file so that it can be used in future directly to save calls
const saveToken  = async (token) => {
  try {
    fs.writeFileSync(token, JSON.stringify(token));
    console.log("Token stored to", token);
  } catch (err) {
    console.error("Error storing token:", err);
  }
}

// utitility function to check for new emails and notify
const inboxCheck  = async(gmail) => {
  try {
    const response = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      maxResults: 1,
    });

    const messages = response.data.messages || [];

    if (messages.length > 0) {
      const firstMessageId = messages[0].id;
      const messageDetails = await gmail.users.messages.get({
        userId: "me",
        id: firstMessageId,
      });

      const toHeader = messageDetails.data.payload.headers.find(
        (header) => header.name === "To"
      );
      const fromHeader = messageDetails.data.payload.headers.find(
        (header) => header.name === "From"
      );
      const recipientAddress = toHeader ? toHeader.value : null;
      const senderAddress = fromHeader ? fromHeader.value : null;

      console.log("Recipient Address:", recipientAddress);
      console.log("Sender Address:", senderAddress);

      return {
        id: messageDetails.data.threadId,
        messages: [messageDetails.data],
        recipientAddress,
        senderAddress,
      };
    } else {
      console.log("No new emails found.");
      return null;
    }
  } catch (error) {
    console.error("Error checking for new emails:", error);
    return null;
  }
}

const sendResponses  = async(gmail, emailDetails, userEmail) =>{
  try {
    if (
      emailDetails &&
      emailDetails.messages &&
      emailDetails.messages.length > 0
    ) {
      const recipientAddress = emailDetails.senderAddress;
      const receivedSubject = emailDetails.messages[0].payload.headers.find(
        (header) => header.name === "Subject"
      ).value;

      if (recipientAddress) {
        const replyMessage = `Can't Read Emails for now, Will get bakck to you soon.`;

        // Encode the entire email message as a base64 string
        const encodedReply = Buffer.from(
          `To: ${recipientAddress}\r\nFrom: ${userEmail}\r\nSubject: Re: ${receivedSubject}\r\n\r\n${replyMessage}`
        ).toString("base64");

        const response = await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            threadId: emailDetails.id,
            raw: encodedReply,
          },
        });

        if (response.status === 200) {
          console.log("Reply sent successfully.");
          return true;
        } else {
          console.error("Error sending replies. Status code:", response.status);
          return false;
        }
      } else {
        console.error("Error: Recipient address not found.");
        return false;
      }
    } else {
      console.error("Error: Email messages are undefined or empty.");
      return false;
    }
  } catch (error) {
    console.error("Error sending replies:", error);
    return false;
  }
}

// utility function to label emails according to their needs and send them
const labellingAndMovingEmails  = async (gmail, threadId, labelName) =>{
  try {
    // Use the Gmail API to get the list of labels
    const labels = await gmail.users.labels.list({
      userId: "me",
    });

    // Check if the desired label exists
    const label = labels.data.labels.find((label) => label.name === labelName);

    if (label) {
      // Apply the label to the thread
      await gmail.users.threads.modify({
        userId: "me",
        id: threadId,
        requestBody: {
          addLabelIds: [label.id],
        },
      });

      console.log(`Email labeled with "${labelName}"`);
      return true;
    } else {
      // If the label doesn't exist, create it
      const createdLabel = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: labelName,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });

      if (createdLabel.status === 200) {
        console.log(`Label "${labelName}" created.`);
        // Apply the label to the thread
        await gmail.users.threads.modify({
          userId: "me",
          id: threadId,
          requestBody: {
            addLabelIds: [createdLabel.data.id],
          },
        });

        console.log(`Email labeled with "${labelName}"`);
        return true;
      } else {
        console.error(
          `Error creating label "${labelName}". Status code:`,
          createdLabel.status
        );
        return false;
      }
    }
  } catch (error) {
    console.error("Error labeling and moving email:", error);
    return false;
  }
}