/** Deployment settings approved after the login callback was registered.
 * Credentials stay in the server environment; these values grant no access
 * without a verified Google identity. Dedicated login credentials take priority.
 */
export const GOOGLE_LOGIN_DEPLOYMENT = {
  reuseMeetClient: true,
  tutorEmails: ['nikates2929@gmail.com', 'lior3226@gmail.com'],
} as const;
