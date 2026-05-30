// aws-exports.ts
// AWS Amplify configuration for PRAHARI
// Replace placeholder values with your actual AWS credentials

const awsConfig = {
  Auth: {
    Cognito: {
      userPoolId: 'ap-south-1_XXXXXXXXX',
      userPoolClientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
      identityPoolId: 'ap-south-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    },
  },
  Storage: {
    S3: {
      bucket: 'datalake-attendance-sync',
      region: 'ap-south-1',
    },
  },
};

export default awsConfig;
