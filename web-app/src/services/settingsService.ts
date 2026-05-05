/**
 * Settings Service
 *
 * Frontend API client for the System Settings API.
 * Provides getSetting and updateSetting methods using the existing ApiService pattern.
 *
 * Validates Requirements: 2.2, 2.6
 */

import ApiService from "./apiService";

export interface SystemSetting {
    settingKey: string;
    settingValue: string;
    updatedAt: string;
}

class SettingsService {
    private apiService = ApiService.getInstance();

    async getSetting(key: string): Promise<SystemSetting> {
        return this.apiService.makeRequest<SystemSetting>(`/settings/${key}`);
    }

    async updateSetting(key: string, value: string): Promise<void> {
        await this.apiService.makeRequest<void>(`/settings/${key}`, {
            method: "PUT",
            body: JSON.stringify({ settingValue: value }),
        });
    }
}

export default new SettingsService();
