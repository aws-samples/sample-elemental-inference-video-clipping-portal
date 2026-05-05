import React from 'react';
import { Spinner, Box } from '@cloudscape-design/components';

interface ConfigLoaderProps {
  message?: string;
}

const ConfigLoader: React.FC<ConfigLoaderProps> = ({ 
  message = 'Loading application configuration...' 
}) => {
  return (
    <div className="config-loader">
      <Spinner size="large" />
      <Box margin={{ top: 'm' }} textAlign="center">
        {message}
      </Box>
    </div>
  );
};

export default ConfigLoader;