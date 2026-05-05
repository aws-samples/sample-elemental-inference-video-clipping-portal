import React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { BreadcrumbGroup } from "@cloudscape-design/components";
import { Home } from "lucide-react";

const Breadcrumbs: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const getBreadcrumbs = () => {
        const pathMap: Record<string, string> = {
            "/": "Events",
            "/channels": "Channels",
            "/video-editor": "Video Editor",
            "/reel-builder": "Highlight Reel Builder",
            "/highlight-reels": "Generated Reels",
            "/feedback": "Video Feedback",
            "/notifications": "Notifications",
            "/docs": "Documentation",
        };

        const breadcrumbs = [{ text: <div style={{display: "flex", alignItems: "center", gap: 4 }}><Home size={16} />Home</div> as any, href: "/" }];

        if (location.pathname.startsWith("/video-editor") && searchParams.get("videoId")) {
            breadcrumbs.push({ text: "Assets", href: "/video-editor" });
        }
        if (location.pathname.startsWith("/reel-builder")) {
            breadcrumbs.push({ text: "Generated Reels", href: "/highlight-reels" });
        }

        const currentPageName = pathMap[location.pathname];
        if (currentPageName && location.pathname !== "/") {
            breadcrumbs.push({ text: currentPageName, href: location.pathname });
        }

        if (location.pathname.startsWith("/generated-reel/")) {
            breadcrumbs.push({ text: "Generated Highlight Reel", href: location.pathname });
        }

        return breadcrumbs;
    };

    const handleFollow = (event: CustomEvent) => {
        event.preventDefault();
        const href = event.detail.href;
        if (href && href !== "#") {
            navigate(href);
        }
    };

    return (
        <BreadcrumbGroup
            items={getBreadcrumbs()}
            onFollow={handleFollow}
            ariaLabel="Breadcrumbs"
            className={"breadcrumb-container"}
        />
    );
};

export default Breadcrumbs;
