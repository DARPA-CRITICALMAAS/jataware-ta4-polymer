This service is designed for a new instance of the cdr or polymer to help get set up with registration of all systems. 

To run this helper service you need to install the poetry project and set up your .env file.

```
cp .env_sample .env
poetry install
```

Update the .env file if the default callback urls are not correct for your local setup.
then you can run

```
poetry run register
```

This will copy over the settings from the other services so we can use the current system name and version and webhook secrets for each to register. 

There will be a token_file.json saved to the root dir where you can copy the token for the other services.

## Updating registration info

Updating registration information is pretty easy with the CDR. You can get a list of registrations from the /user/me/registrations endpoint. Then for whatever registration you want to update you use that id to update the information with the endpoint /user/me/registrations. You can do this programmatically or via the fastapi docs page. http://localhost:8333/docs#
You can delete and reregister the registration as well to achieve the same thing.

## Using ngrok locally for CDR listeners
If you are using ngrok locally to serve the baseline model or the jataware_georef then you might need to update the callback url often. 
I run those in containers locally then run 
```
ngrok http {port_of_container}
```
I grab the new url and update the callback url with the correct path to the listening endpoint. 
```
Forwarding                    https://5d8a-2601-649-200-6810-298-a96d-25e3-e66c.ngrok-free.app -> http://localhost
```
So I would grab the forwarding url and add /model/project for the baseline model.

