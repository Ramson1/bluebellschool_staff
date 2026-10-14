import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

// Server-side email sender for staff CRUD notifications, mirroring the admin
// portal's /api/send-email. Sends via Gmail SMTP using GMAIL_USER +
// GMAIL_APP_PASSWORD from the environment.
const createTransporter = () =>
  nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

// GET method to check if the API is working
export async function GET() {
  return NextResponse.json({ message: 'Email API is running' });
}

// Function to get admin email from Supabase settings
async function getAdminEmail() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data: settings, error } = await supabase
      .from('bluebell_settings')
      .select('adminEmail')
      .limit(1);

    if (error) {
      console.error('Error fetching admin email from settings:', error);
      return null;
    }

    return settings && settings.length > 0 ? settings[0].adminEmail : null;
  } catch (error) {
    console.error('Error getting admin email:', error);
    return null;
  }
}

// POST method to send emails
export async function POST(request) {
  try {
    const { subject, message, recipients } = await request.json();

    console.log('📧 [API] Email request received:', { subject, recipients });

    if (!subject || !message) {
      console.error('❌ [API] Missing required fields');
      return NextResponse.json(
        { error: 'Missing required fields: subject, message' },
        { status: 400 }
      );
    }

    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      console.error('❌ [API] Gmail credentials not configured');
      return NextResponse.json(
        { error: 'Email service not configured. Please set GMAIL_USER and GMAIL_APP_PASSWORD environment variables.' },
        { status: 500 }
      );
    }

    let toAddress;

    if (recipients && Array.isArray(recipients) && recipients.length > 0) {
      toAddress = recipients.join(', ');
    } else if (recipients && typeof recipients === 'string') {
      toAddress = recipients;
    } else {
      const adminEmail = await getAdminEmail();
      if (!adminEmail) {
        console.error('❌ [API] No recipients configured');
        return NextResponse.json(
          { error: 'No email recipients configured' },
          { status: 500 }
        );
      }
      toAddress = adminEmail;
    }

    console.log('📧 [API] Sending email to:', toAddress);

    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: toAddress,
      subject: subject,
      text: message,
    };

    const info = await transporter.sendMail(mailOptions);

    console.log('✅ [API] Email sent successfully:', info.messageId);

    return NextResponse.json({
      message: 'Email sent successfully',
      messageId: info.messageId,
    });
  } catch (error) {
    console.error('❌ [API] Error sending email:', error);
    return NextResponse.json(
      { error: 'Failed to send email', details: error.message },
      { status: 500 }
    );
  }
}
