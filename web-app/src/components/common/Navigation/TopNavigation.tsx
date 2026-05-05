import React, { useState } from "react";
import { Button, TopNavigation as CloudscapeTopNavigation } from "@cloudscape-design/components";
import { useNavigate } from "react-router-dom";
import PreferencesModal from "../PreferencesModal/PreferencesModal";
import SettingsModal from "../SettingsModal/SettingsModal";

interface TopNavigationProps {
    user?: any;
    signOut?: () => void;
}

const TopNavigation: React.FC<TopNavigationProps> = ({ user, signOut }) => {
    const navigate = useNavigate();
    const [preferencesVisible, setPreferencesVisible] = useState(false);
    const [settingsVisible, setSettingsVisible] = useState(false);

    const handleIdentityClick = () => {
        navigate("/");
    };

    const handleSignOut = () => {
        if (signOut) {
            signOut();
        }
    };

    const handleUtilityClick = (event: CustomEvent<{ id: string }>) => {
        const { id } = event.detail;
        if (id === "preferences") {
            setPreferencesVisible(true);
        } else if (id === "settings") {
            setSettingsVisible(true);
        } else if (id === "documentation") {
            navigate("/docs");
        }
    };

    return (
        <>
        <div id="top-nav">
            <CloudscapeTopNavigation
                identity={{
                    href: "/",
                    title: (
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <img src={"/aws-logo-white.png"} height={25} alt={"logo"} />
                            AWS Elemental Inference Clipping & Cropping
                        </div>
                    ) as any,
                    onFollow: handleIdentityClick,
                }}
                utilities={[
                    // {
                    //     type: "button",
                    //     iconName: "notification",
                    //     title: "Notifications",
                    //     ariaLabel: "Notifications (unread)",
                    //     badge: true,
                    //     disableUtilityCollapse: false,
                    // },
                    {
                        type: "menu-dropdown",
                        text: user?.username || (user as any)?.attributes?.email || "User",
                        description: user?.username,
                        iconName: "user-profile",
                        onItemClick: handleUtilityClick,
                        items: [
                            { id: "preferences", text: "Preferences" },
                            { id: "settings", text: "System Settings" },
                            {
                                id: "support-group",
                                text: "Support",
                                items: [
                                    {
                                        id: "documentation",
                                        text: "Documentation",
                                    },
                                    // { id: "support", text: "Support" },
                                    // {
                                    //     id: "feedback",
                                    //     text: "Feedback",
                                    //     href: "#",
                                    //     external: true,
                                    //     externalIconAriaLabel: " (opens in new tab)",
                                    // },
                                ],
                            },
                            {
                                id: "signout",
                                itemType: "action",
                                text: (
                                    <Button variant={"link"} onClick={handleSignOut}>
                                        Sign out
                                    </Button>
                                ) as any,
                            },
                        ],
                    },
                ]}
            />
        </div>
        <PreferencesModal
            visible={preferencesVisible}
            onDismiss={() => setPreferencesVisible(false)}
        />
        <SettingsModal
            visible={settingsVisible}
            onDismiss={() => setSettingsVisible(false)}
        />
        </>
    );
};

export default TopNavigation;
