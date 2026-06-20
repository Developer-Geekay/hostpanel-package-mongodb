from setuptools import setup, find_packages

setup(
    name="hostpanel-mongodb",
    version="1.0.0",
    packages=find_packages(),
    install_requires=["fastapi", "pydantic", "pymongo"],
    entry_points={
        "hostpanel.modules": [
            "mongodb = hostpanel_mongodb.plugin",
        ],
        "hostpanel.setup": [
            "hostpanel-mongodb = hostpanel_mongodb.lifecycle:on_install",
        ],
        "hostpanel.lifecycle": [
            "hostpanel-mongodb = hostpanel_mongodb.lifecycle:pre_uninstall",
        ],
        "hostpanel.hooks.on_startup": [
            "hostpanel-mongodb = hostpanel_mongodb.lifecycle:on_startup",
        ],
    },
)
