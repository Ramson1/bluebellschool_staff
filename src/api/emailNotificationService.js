// emailNotificationService.js - Service for sending email notifications for CRUD operations

// Function to get admin email from Supabase settings
// const getAdminEmail = async (supabase) => {
//   try {
//     const { data: settings, error } = await supabase
//       .from('bluebell_settings')
//       .select('adminEmail')
//       .limit(1);

//     if (error) {
//       console.error('Error fetching admin email from settings:', error);
//       return null;
//     }

//     return settings && settings.length > 0 ? settings[0].adminEmail : null;
//   } catch (error) {
//     console.error('Error getting admin email:', error);
//     return null;
//   }
// };

// Function to get all email recipients from Supabase settings
const getEmailRecipients = async (supabase) => {
  try {
    const { data: settings, error } = await supabase
      .from('bluebell_settings')
      .select('adminEmail, additionalemails')
      .limit(1);

    if (error) {
      console.error('Error fetching email recipients from settings:', error);
      return null;
    }

    const recipients = [];
    
    if (settings && settings.length > 0) {
      // Add admin email
      if (settings[0].adminEmail) {
        recipients.push(settings[0].adminEmail);
      }
      
      // Add additional emails if they exist (comma-separated)
      if (settings[0].additionalemails) {
        const additionalEmails = settings[0].additionalemails.split(',').map(email => email.trim()).filter(email => email);
        recipients.push(...additionalEmails);
      }
    }
    
    return recipients.length > 0 ? recipients : null;
  } catch (error) {
    console.error('Error getting email recipients:', error);
    return null;
  }
};

// Function to get admin email from Supabase settings
const getAdminEmail = async (supabase) => {
  try {
    const recipients = await getEmailRecipients(supabase);
    return recipients && recipients.length > 0 ? recipients[0] : null;
  } catch (error) {
    console.error('Error getting admin email:', error);
    return null;
  }
};

// Function to send email notification
const sendEmailNotification = async (supabase, subject, message, recipients = null) => {
  try {
    let emailRecipients = recipients;
    
    // If no recipients provided, get all configured recipients from database
        // An empty array means this school has not configured an address yet —
    // fall back to the settings lookup instead of POSTing mail to nobody.
    if (!emailRecipients || !emailRecipients.length) {
      emailRecipients = await getEmailRecipients(supabase);
      
      if (!emailRecipients || emailRecipients.length === 0) {
        console.warn('⚠️ No email recipients configured in bluebell_settings');
        return { success: false, error: 'No email recipients configured' };
      }
    }

    // Ensure it's always an array
    const recipientArray = Array.isArray(emailRecipients) ? emailRecipients : [emailRecipients];

    console.log('📧 Sending email to:', recipientArray.join(', '));
    console.log('📧 Subject:', subject);
    console.log('📧 Message length:', message.length);

    // Send email via API - this works in both development and production
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: subject,
        message: message,
        recipients: recipientArray
      })
    });

    const result = await response.json();
    
    console.log('📧 API Response status:', response.status);
    console.log('📧 API Response:', result);
    
    if (response.ok) {
      console.log('✅ Email sent successfully to:', recipientArray.join(', '));
      console.log('📨 Message ID:', result.messageId);
      return { success: true, messageId: result.messageId };
    } else {
      console.error('❌ Error sending email:', result.error, result.details);
      return { success: false, error: result.error, details: result.details };
    }
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendEmailNotification,
  getEmailRecipients,
  getAdminEmail
};