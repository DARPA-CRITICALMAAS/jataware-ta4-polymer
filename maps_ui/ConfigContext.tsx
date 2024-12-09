import React, { createContext, useContext, useState, useEffect } from 'react';

interface Config {
    POLYMER_PUBLIC_BUCKET: string;
    CDR_PUBLIC_BUCKET: string;
    CDR_COG_URL: string;
    CDR_S3_COG_PREFEX: string;
    CDR_S3_COG_PRO_PREFEX: string;
    MAPTILER_KEY: string;
}

const ConfigContext = createContext<Config | null>(null);

export const useConfig = () => {
    const context = useContext(ConfigContext);
    if (!context) {
        throw new Error('useConfig must be used within a ConfigProvider');
    }
    return context;
};

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [config, setConfig] = useState<Config | null>(null);

    useEffect(() => {
        fetch('/config.json')
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Failed to load config.json');
                }
                return response.json();
            })
            .then((data) => setConfig(data))
            .catch((error) => {
                console.error('Error loading config:', error);
            });
    }, []);

    if (!config) {
        return <div>Loading configuration...</div>;
    }

    return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
};