
import os
import shutil
import httpx
import json 

from register_polymer.register_settings import app_settings

separator_length=50
auth = {
    "Authorization": app_settings.cdr_bearer_token,
}

def register_silk(_auth):
    
    from register_polymer.setting_files.silk_settings import app_settings as silk_settings
    print(silk_settings)
    payload = {
            "name": silk_settings.cdr_system_name,
            "version": silk_settings.cdr_system_version,
            "callback_url": "https://example.com/",
            "webhook_secret": "",
            "auth_header": "",
            "auth_token": "",
            "events": ["ping"]
        }
    resp = httpx.post(f"{app_settings.cdr_endpoint_url}/user/me/register",
                           data=json.dumps(payload),
                            headers=_auth ).json()
    print(f'silk response {resp}')



def register_jataware_georef(_auth):
   
    from register_polymer.setting_files.jataware_georef_settings import app_settings as jataware_georef_settings
    payload = {
            "name": jataware_georef_settings.system,
            "version": jataware_georef_settings.version,
            "callback_url": app_settings.jataware_georef_callback_url,
            "webhook_secret": jataware_georef_settings.secret_token,
            "auth_header": "",
            "auth_token": "",
            "events": ["feature.process", "ping", "georef.process", "map.process"]
        }
    resp = httpx.post(f"{app_settings.cdr_endpoint_url}/user/me/register",
                           data=json.dumps(payload),
                            headers=_auth ).json()
    print(f'jataware_georef response {resp}')


def register_auto_georef(_auth):

    from register_polymer.setting_files.auto_georef_settings import app_settings as auto_georef_settings
    payload = {
            "name": auto_georef_settings.polymer_auto_georef_system,
            "version": auto_georef_settings.polymer_auto_georef_system_version,
            "callback_url": "https://example.com/",
            "webhook_secret": "",
            "auth_header": "",
            "auth_token": "",
            "events": ["ping"]
        }
    resp = httpx.post(f"{app_settings.cdr_endpoint_url}/user/me/register",
                           data=json.dumps(payload),
                            headers=_auth ).json()
    print(f'auto_georef response {resp}')

def register_baseline_mpm(_auth):

    from register_polymer.setting_files.baseline_mpm_settings import app_settings as baseline_settings
    payload = {
            "name": baseline_settings.system_name,
            "version": baseline_settings.system_version,
            "callback_url": app_settings.baseline_mpm_callback_url,
            "webhook_secret": baseline_settings.secret_token,
            "auth_header": "",
            "auth_token": "",
            "events": ["ping","prospectivity_model_run.process"]
        }
    resp = httpx.post(f"{app_settings.cdr_endpoint_url}/user/me/register",
                           data=json.dumps(payload),
                            headers=_auth ).json()
    print(f'baseline response {resp}')

def register_upload(_auth):
    payload={
        "name": "upload",
        "version": "1.0",
        "callback_url": "https://example.com/",
                "webhook_secret": "",
                "auth_header": "",
                "auth_token": "",
                "events": ["ping"]
        }
    resp = httpx.post(f"{app_settings.cdr_endpoint_url}/user/me/register",
                           data=json.dumps(payload),
                            headers=_auth ).json()
    print(f'upload response {resp}')


def main():
    source_dirs = {
        "silk": "../silk/silk",
        "jataware_georef": "../jataware_georef/jataware_georef",
        "baseline_mpm": "../baseline_mpm/baseline_mpm",
        "auto_georef": "../auto-georef/auto_georef",
    }

    destination_dir = "./register_polymer/setting_files"

    os.makedirs(destination_dir, exist_ok=True)

    for name, source_dir in source_dirs.items():
        source_file = os.path.join(source_dir, "settings.py")
        if os.path.exists(source_file):
            destination_file = os.path.join(destination_dir, f"{name}_settings.py")
            shutil.copy(source_file, destination_file)
            print(f"Copied and renamed: {source_file} -> {destination_file}")
        else:
            print(f"Skipped: {source_file} (not found)")

    user_token = register_user()
    _auth = {
            "Authorization": f"Bearer {user_token}",
        }
    
    print('Registering Silk')
    register_silk(_auth)
    print(f"{'_' * separator_length}")

    print('Registering Jataware_georef')
    register_jataware_georef(_auth)
    print(f"{'_' * separator_length}")

    print('Registering Auto Georef')
    register_auto_georef(_auth)
    print(f"{'_' * separator_length}")

    print('Registering Baseline MPM')
    register_baseline_mpm(_auth)
    print(f"{'_' * separator_length}")

    print('Registering Upload')
    register_upload(_auth)
    print(f"{'_' * separator_length}")

    print('Finished registering systems. Make sure callback urls are correct')


#  register a new user with the cdr.
def register_user():
    print("checking connection")
    r = httpx.get(f"{app_settings.cdr_endpoint_url}/v1/health/check")
    r.raise_for_status()
    if r.status_code != 204:
        print("couldn't connect to local cdr")
        return
    
    r = httpx.get(f"{app_settings.cdr_admin_endpoint_url}/admin/users/list",
                  headers=auth)
    r.raise_for_status()
    if r.status_code != 200:
        print("couldn't connect to local admin cdr")
        return

    # create new user
    user = httpx.post(f"{app_settings.cdr_admin_endpoint_url}/admin/users/new",
                          data=json.dumps({"name":app_settings.cdr_user}),
                           headers=auth ).json()
    user_id =user.get("id")
    # create token for this user 
    token_info = httpx.post(f"{app_settings.cdr_admin_endpoint_url}/admin/tokens/new/{user_id}",
                            headers=auth ).json()
    # token_info={'id': '7db275a54d6c4022b22f32198685c5be', 'token': '18f8ec6c78914bb13a97e8f7ddc8449347c8c96b7539f1d317f91754ed03bd98'}

    print(f'USER name = {app_settings.cdr_user}')
    print(f'USER id = {user_id}')
    print(f'USER TOKEN = {token_info.get("token")}')
    with open('token_file.json', 'w') as f:
        f.write(json.dumps(token_info))
    print("Saved token info to token_file.json in root dir")


    # update roles
    roles = httpx.put(f'{app_settings.cdr_admin_endpoint_url}/admin/tokens/roles/{token_info.get("id")}?request_roles=map&request_roles=ngmdb&request_roles=doc&request_roles=prospectivity&request_roles=georef&request_roles=user&request_roles=feature',
              headers=auth)
    if roles.status_code !=200:
        print(roles.text)
        print("Error setting roles for user")
    roles.raise_for_status()

    return token_info.get("token")

    

if __name__ =="__main__":
    main()