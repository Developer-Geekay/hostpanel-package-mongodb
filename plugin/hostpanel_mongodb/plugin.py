from hostpanel_mongodb.databases import router

PLUGIN_MANIFEST = {
    "requires_core": [1, 0, 0],
    "repository": "https://github.com/Developer-Geekay/hostpanel-package-mongodb",
    "nav_items": [
        {
            "nav_route": "mongodb",
            "nav_label": "MongoDB",
            "nav_icon": "database",
            "nav_section": "databases",
            "nav_section_label": "Databases",
            "nav_section_order": 30,
            "admin_only": True,
        },
    ],
    "dashboard_blocks": [
        {
            "type": "stat",
            "label": "MongoDB Databases",
            "icon": "database",
            "endpoint": "mongodb/count",
            "size": "sm",
        },
    ],
    "service": {
        "name": "mongodb",
        "unit": "hostpanel-mongodb",
        "label": "MongoDB",
        "icon": "database",
        "can_reload": False,
        "config_path": "/opt/hostpanel/plugins/mongodb/mongod.conf",
    },
}
